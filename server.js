import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MENU_PATH = join(__dirname, 'menu.json');

// ── Menu helpers ──────────────────────────────────────────────

function loadMenu() {
  try {
    return JSON.parse(readFileSync(MENU_PATH, 'utf8'));
  } catch {
    return { dishes: [] };
  }
}

function saveMenu(menu) {
  writeFileSync(MENU_PATH, JSON.stringify(menu, null, 2), 'utf8');
}

function buildSystemPrompt(dishes) {
  const dishText = dishes.map(d => {
    const flags = [];
    if (d.glutenFree)        flags.push('gluten-free');
    if (d.dairyFree)         flags.push('dairy-free');
    if (d.nutFree)           flags.push('nut-free');
    if (d.vegetarian)        flags.push('vegetarian');
    if (d.containsEggs)      flags.push('contains eggs');
    if (d.containsShellfish) flags.push('contains shellfish');
    if (d.containsFish)      flags.push('contains fish');
    if (d.containsAlcohol)   flags.push(`contains alcohol (${d.alcoholNote || 'see notes'})`);
    if (d.seedOil)           flags.push('fried/cooked in seed oil (vegetable oil)');

    return `${d.name.toUpperCase()}
${d.description ? d.description + '. ' : ''}Ingredients: ${d.ingredients}.
Cooking fat/oil: ${d.cookingFat}.
Dietary flags: ${flags.join(', ') || 'none noted'}.
${d.notes ? 'Notes: ' + d.notes : ''}`.trim();
  }).join('\n\n');

  return `You are the menu guide at Garcia's Seafood Grille & Fish Market, a family-owned waterfront restaurant on the Miami River that's been serving the freshest seafood since 1966. Your job is to help guests understand exactly what's in their food — ingredients, allergens, cooking oils, and dietary info — so they can eat with confidence.

Be warm, direct, and unpretentious. Talk like someone who genuinely knows this food and cares about the guest getting it right. No filler, no corporate language, no sign-offs. Plain natural sentences only — never use bullet points, dashes, or numbered lists. For a simple question, one or two sentences is plenty. For something more involved, cover it fully but stay tight.

If a guest has a severe allergy, always tell them to let their server know so the kitchen can take extra care. If asked about a dish or ingredient not on this menu, let them know you can only speak to what's listed and send them to their server for anything else.

Never guess. If you're not sure, say so and point them to the kitchen.

Here is everything you know about our current menu:

${dishText || 'No dishes are currently on the menu. Please check back soon.'}`;
}

// ── Admin auth middleware ─────────────────────────────────────

function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Static files ──────────────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'admin.html'));
});

// Serve index.html and other static files, but not menu.json
app.use(express.static(__dirname, { index: 'index.html' }));

// ── Menu API ──────────────────────────────────────────────────

app.get('/api/menu', (req, res) => {
  res.json(loadMenu());
});

app.post('/api/menu/dish', requireAdmin, (req, res) => {
  const menu = loadMenu();
  const dish = {
    id: Date.now().toString(),
    name: req.body.name || '',
    description: req.body.description || '',
    ingredients: req.body.ingredients || '',
    cookingFat: req.body.cookingFat || '',
    glutenFree: !!req.body.glutenFree,
    dairyFree: !!req.body.dairyFree,
    nutFree: !!req.body.nutFree,
    vegetarian: !!req.body.vegetarian,
    containsEggs: !!req.body.containsEggs,
    containsShellfish: !!req.body.containsShellfish,
    containsFish: !!req.body.containsFish,
    containsAlcohol: !!req.body.containsAlcohol,
    alcoholNote: req.body.alcoholNote || '',
    seedOil: !!req.body.seedOil,
    notes: req.body.notes || '',
  };
  menu.dishes.push(dish);
  saveMenu(menu);
  res.json({ ok: true, dish });
});

app.put('/api/menu/dish/:id', requireAdmin, (req, res) => {
  const menu = loadMenu();
  const idx = menu.dishes.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Dish not found' });
  menu.dishes[idx] = { ...menu.dishes[idx], ...req.body, id: req.params.id };
  saveMenu(menu);
  res.json({ ok: true, dish: menu.dishes[idx] });
});

app.delete('/api/menu/dish/:id', requireAdmin, (req, res) => {
  const menu = loadMenu();
  const idx = menu.dishes.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Dish not found' });
  menu.dishes.splice(idx, 1);
  saveMenu(menu);
  res.json({ ok: true });
});

// ── Chat API ──────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages format.' });
  }

  try {
    const { dishes } = loadMenu();
    const systemPrompt = buildSystemPrompt(dishes);

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages,
    });

    const reply = response.content[0]?.text || 'I apologize, I was unable to generate a response.';
    res.json({ reply });
  } catch (err) {
    console.error('Anthropic API error:', err);
    res.status(502).json({ error: 'Unable to reach the AI service. Please try again.' });
  }
});

// ── Start ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Garcia's Seafood chatbot running on http://localhost:${PORT}`));
