# The Cookbook — Members Area

A cooking community web app where members log in to browse recipes across six dietary tracks (no restrictions, vegan, sugar free, gluten free, dairy free, carnivore), with five recipes each for breakfast, lunch, and dinner.

## Stack

- Single-file HTML app (`index.html`) — vanilla HTML + CSS + JS, no build step, no dependencies
- Liquid-glass UI layered over a photographic backdrop (`background.jpg` for portrait / mobile, `background-wide.jpg` for landscape / desktop)
- localStorage-based mock auth (demo account: `demo@cook.com` / `demo123`)

## Run locally

Open `index.html` in any modern browser. No server required.

## Deploy

Drop the folder into Cloudflare Pages (or any static host — Netlify, Vercel, GitHub Pages all work). No build step, no server.

## Roadmap

- Real cross-device auth (Cloudflare Workers + D1, or Supabase)
- Shopify Buy Button integration for cookbook / membership sales
- Recipe favoriting and member-saved collections
- More recipes per slot, member-submitted recipes
