// ============================================================================
// storage.js - Local settings storage helpers + nav
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= STORAGE HELPERS ============================= */
async function sGet(key, shared){
  if(shared){ try{ const r = await window.storage.get(key, true); return r? JSON.parse(r.value): null; }catch(e){ return null; } }
  try{ const raw = localStorage.getItem(key); return raw? JSON.parse(raw): null; }catch(e){ return null; }
}
async function sSet(key, value, shared){
  if(shared){ try{ return await window.storage.set(key, JSON.stringify(value), true); }catch(e){ return null; } }
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }catch(e){ return null; }
}

const COLORS = ["#e5484d","#e0b13c","#4fb0ff","#39c477","#ff8ac4","#9a6bff","#ff9d4d","#43dede","#c2e04a","#ff5c9e",
  "#5c6bff","#ff7043","#2fd4b0","#f2f2f2","#8a8f98","#101418","#c77dff","#4dd0e1","#ffd166","#ef476f"];

// 15 purchasable avatar frames - nicer ones cost progressively more
const FRAMES = [
  {cls:'frame-1', price:800}, {cls:'frame-2', price:850}, {cls:'frame-3', price:900},
  {cls:'frame-4', price:1000}, {cls:'frame-5', price:1000}, {cls:'frame-6', price:1000},
  {cls:'frame-7', price:1100}, {cls:'frame-8', price:1300}, {cls:'frame-9', price:1500},
  {cls:'frame-10', price:1500}, {cls:'frame-11', price:1800}, {cls:'frame-12', price:2000},
  {cls:'frame-13', price:2200}, {cls:'frame-14', price:2400}, {cls:'frame-15', price:2600}
];

let account = null;
function newAccount(name,pass){
  return {name,pass,coins:0,gcoin:0,stats:{speed:0,power:0,kickPower:0,control:0},charStats:{base:{speed:0,power:0,kickPower:0,control:0}},colors:[0],equippedColor:0,lastNumber:null,
    totalGoals:0,totalAssists:0,totalWins:0,avatar:null,frame:null,framesOwned:[],skinsOwned:[],equippedCharacterId:null,
    aurasOwned:[],equippedAura:null,exp:0,level:1,cups:0};
}

/* ============================= NAV ============================= */
let currentMode = '2v2';
let selectedNumber = null;
let playerDisplayName = '';

function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
let settingsOpenedInMatch = false;
document.getElementById('settingsBackBtn').addEventListener('click', (e)=>{
  if(settingsOpenedInMatch){
    e.stopImmediatePropagation();
    document.getElementById('screen-settings').classList.add('hidden');
    settingsOpenedInMatch = false;
  }
});
document.querySelectorAll('[data-back]').forEach(el=>{
  el.addEventListener('click', ()=> show(el.getAttribute('data-back')));
});

