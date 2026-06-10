# 🏆 Disney Lorcana Weekly Card Price Puller

This is a standalone, lightweight NodeJS utility that pulls real-time market pricing for Disney Lorcana cards from the free community **Lorcast API**, compiles the top 10 most expensive standard and foil cards, and writes the results to Markdown and JSON formats.

To keep the lists useful, promotional/trophy cards (which have highly skewed collector values up to $10,000) are separated from regular set releases.

---

## 📁 Project Structure
- `package.json`: NodeJS ESM configuration.
- `pull.js`: Sequential data fetching, price processing, sorting, and output generation.
- `index.html`: Interactive web dashboard hosted on GitHub Pages.
- `style.css`: Premium glassmorphic stylesheet for the web dashboard.
- `top_priced_cards.md`: A beautiful, auto-generated Markdown report showing standard releases, foil releases, standard promos, and foil promos.
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

## ⏰ Scheduling Guide (Weekly Run)

To automate this task every week, choose one of these methods:

### Option A: Gemini Chat UI `/schedule` (Recommended)
You can schedule a recurring cron command directly in the chat interface. Simply run the `/schedule` command or send this prompt to the assistant:
> *"Schedule the command `node C:\Users\Thomas\lorcana-price-puller\pull.js` to run weekly every Monday at 9:00 AM."*

### Option B: Windows Task Scheduler (Native Background Execution)
To run this automatically in the background of your Windows machine even when you are not in the chat interface:

1. Open **PowerShell** as Administrator.
2. Register a weekly scheduled task by running the following command:
   ```powershell
   Register-ScheduledTask -TaskName "LorcanaWeeklyPricePuller" -Trigger (New-ScheduledTrigger -Weekly -DaysOfWeek Monday -At 9am) -Action (New-ScheduledTaskAction -Execute "node" -Argument "C:\Users\Thomas\lorcana-price-puller\pull.js") -Description "Pulls the top 10 priced Lorcana cards weekly." -Force
   ```
3. The task will now execute silently every Monday at 9:00 AM and overwrite the `top_priced_cards.md` and `top_priced_cards.json` files in this folder.

---

## 🎨 Theme Version
- **Theme Version**: 1.0.2
