import { optimisePortions } from "../lib/optimise";
import type { Macros } from "../lib/nutrition";
const items = Array.from({length: 16}, (_,i)=>({
  name: ["Chicken breast","Basmati rice","Olive oil","Broccoli","Oats","Whey protein","Milk","Eggs","Sweet potato","Greek yoghurt","Peanut butter","Salmon","Bread","Banana","Pasta","Cheddar"][i],
  grams: 60 + i*7, kcal_100: 100+i*40, protein_100: 5+i, carbs_100: 20, fat_100: 3+i*0.5, fibre_100: 2,
}));
const target: Macros = { kcal: 3200, protein: 175, carbs: 380, fat: 95 };
const t0 = Date.now();
for (let i=0;i<20;i++) optimisePortions(structuredClone(items), target, {mode:"balanced"});
console.log("16 ingredients, per solve:", ((Date.now()-t0)/20).toFixed(1), "ms");
