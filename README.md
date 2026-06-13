# 🏆 TCG Weekly Card Price Finder

This is a standalone, lightweight NodeJS utility that pulls real-time market pricing for **Disney Lorcana** (via Lorcast API) and **Riftbound TCG** (via TCGCSV / TCGPlayer) cards, compiles the top 10 most expensive standard and foil cards, and writes the results to Markdown, JSON, and an interactive Web Dashboard.

To keep the lists useful, promotional/trophy cards (which have highly skewed collector values) are separated from regular set releases.

---

## 📁 Project Structure
- `package.json`: NodeJS ESM configuration.
- `pull.js`: Sequential data fetching, price processing, sorting, and output generation for both TCGs.
- `index.html`: Interactive web dashboard hosted on GitHub Pages with game-switching capabilities.
- `style.css`: Premium glassmorphic stylesheet for the web dashboard.
- `top_priced_cards.md`: A beautiful, auto-generated Markdown report showing standard releases, foil releases, and special chase versions (Enchanted & Showcase/Signature) for both games.
- `top_priced_cards.json`: Structured raw data of the compiled rankings.

---

## 🚀 How to Run Manually

### Prerequisites
- [Node.js](https://nodejs.org/) installed (v18.0.0 or higher is required for native `fetch`).

### Execution
From your terminal, navigate to this directory (`C:\Users\Thomas\lorcana-price-puller`) and run:
```bash
npm start
```
Or execute the script directly using:
```bash
node pull.js
```

---

## ⏰ Scheduling Guide (Daily Run)

To automate this task every day and keep your hosted GitHub Pages dashboard up-to-date, choose one of these methods:

### Option A: Gemini Chat UI `/schedule` (Recommended)
You can schedule a recurring cron command directly in the chat interface. Simply run the `/schedule` command or send this prompt to the assistant:
> *"Schedule the command `node C:\Users\Thomas\lorcana-price-puller\pull.js` to run daily at 9:00 AM."*

### Option B: Windows Task Scheduler (Native Background Execution)
To run this automatically in the background of your Windows machine even when you are not in the chat interface:

1. Open **PowerShell** as Administrator.
2. Register a daily scheduled task by running the following command:
   ```powershell
   Register-ScheduledTask -TaskName "TCGWeeklyPricePuller" -Trigger (New-ScheduledTrigger -Daily -At 9am) -Action (New-ScheduledTaskAction -Execute "node" -Argument "C:\Users\Thomas\lorcana-price-puller\pull.js") -Description "Pulls the top priced Lorcana and Riftbound cards daily." -Force
   ```
3. The task will now execute silently every day at 9:00 AM and overwrite the output files in this folder.

---

## 🎨 Theme Version
- **Theme Version**: 1.0.4
