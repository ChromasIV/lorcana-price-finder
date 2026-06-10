import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for rate-limiting (delaying execution in milliseconds)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Robust fetch with retry and exponential backoff to handle rate limits and socket drops
async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 1000) {
  try {
    // Set 'Connection: close' to prevent Node's Undici connection pool timeouts and socket drops
    const headers = { ...options.headers, 'Connection': 'close' };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && retries > 0) {
        console.warn(`⚠️ Request returned HTTP ${response.status}. Retrying in ${backoffMs}ms... (${retries} attempts left)`);
        await delay(backoffMs);
        return fetchWithRetry(url, options, retries - 1, backoffMs * 2);
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`⚠️ Fetch failed (${error.message}). Retrying in ${backoffMs}ms... (${retries} attempts left)`);
      await delay(backoffMs);
      return fetchWithRetry(url, options, retries - 1, backoffMs * 2);
    }
    throw error;
  }
}

// Helper to determine if a card is a promotional / special release card
function isPromoCard(card) {
  const setCode = card.set_code.toLowerCase();
  const setName = card.set_name.toLowerCase();
  const rarity = card.rarity.toLowerCase();
  
  return (
    rarity === 'promo' ||
    setCode.startsWith('p') ||
    setCode === 'cp' ||
    setCode === 'c2' ||
    setCode === 'd23' ||
    setCode === 'dis' || // EPCOT Festival of the Arts
    setName.includes('promo') ||
    setName.includes('challenge') ||
    setName.includes('d23') ||
    setName.includes('festival')
  );
}

async function main() {
  console.log('=== Lorcana Card Price Puller ===');
  console.log('Timestamp:', new Date().toLocaleString());
  console.log('Fetching all active sets from Lorcast API...');

  try {
    const setsResponse = await fetchWithRetry('https://api.lorcast.com/v0/sets');
    const setsData = await setsResponse.json();
    const sets = setsData.results || [];
    console.log(`Successfully retrieved ${sets.length} sets.`);

    let allCards = [];

    // Fetch cards for each set with a delay to respect rate limiting (Lorcast requests 50-100ms)
    // We use a safer 200ms delay and fetchWithRetry with disabled keep-alive for maximum robustness
    for (const [index, set] of sets.entries()) {
      console.log(`[${index + 1}/${sets.length}] Fetching cards for set: ${set.name} (${set.code})...`);
      
      try {
        const cardsResponse = await fetchWithRetry(`https://api.lorcast.com/v0/sets/${set.code}/cards`);
        const cardsData = await cardsResponse.json();
        allCards = allCards.concat(cardsData);
        console.log(`   -> Retrieved ${cardsData.length} cards.`);
      } catch (err) {
        console.warn(`⚠️ Warning: Failed to fetch cards for set ${set.code} after retries: ${err.message}. Skipping.`);
      }

      // Safe 200ms delay to stay well under the 10 requests/sec limit
      await delay(200);
    }

    console.log(`Total raw cards successfully fetched: ${allCards.length}`);
    if (allCards.length === 0) {
      throw new Error('No cards retrieved from the API.');
    }

    // Parse and filter cards with valid prices
    const processedCards = allCards.map((card) => {
      const usdPrice = card.prices?.usd ? parseFloat(card.prices.usd) : null;
      const usdFoilPrice = card.prices?.usd_foil ? parseFloat(card.prices.usd_foil) : null;
      
      // Some promo cards are missing 'normal' or 'small' image sizes, so we check for 'large' as well
      const imageUrl = card.image_uris?.digital?.normal || 
                        card.image_uris?.digital?.large || 
                        card.image_uris?.digital?.small || 
                        '';

      return {
        id: card.id,
        name: card.name,
        version: card.version || 'N/A',
        rarity: card.rarity || 'Common',
        set_code: card.set?.code || 'N/A',
        set_name: card.set?.name || 'N/A',
        usd: usdPrice,
        usd_foil: usdFoilPrice,
        image_url: imageUrl,
        purchase_url: card.purchase_uris?.tcgplayer || '',
        collector_number: card.collector_number || ''
      };
    });

    // Separate regular cards from promotional cards
    const regularCards = processedCards.filter(c => !isPromoCard(c));
    const promoCards = processedCards.filter(c => isPromoCard(c));

    // A. Regular (Non-Promo) Top Lists
    const regularStandard = regularCards
      .filter((c) => c.usd !== null && !isNaN(c.usd))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10);

    const regularFoil = regularCards
      .filter((c) => c.usd_foil !== null && !isNaN(c.usd_foil))
      .sort((a, b) => b.usd_foil - a.usd_foil)
      .slice(0, 10);

    // B. Promotional Top Lists
    const promoStandard = promoCards
      .filter((c) => c.usd !== null && !isNaN(c.usd))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10);

    const promoFoil = promoCards
      .filter((c) => c.usd_foil !== null && !isNaN(c.usd_foil))
      .sort((a, b) => b.usd_foil - a.usd_foil)
      .slice(0, 10);

    // C. Group Enchanted & Iconic Cards by Set
    const enchantedBySet = {};
    const enchantedCards = processedCards.filter(
      (c) => c.rarity.toLowerCase() === 'enchanted' || c.rarity.toLowerCase() === 'iconic'
    );

    enchantedCards.forEach((card) => {
      const setCode = card.set_code;
      if (!enchantedBySet[setCode]) {
        enchantedBySet[setCode] = {
          code: setCode,
          name: card.set_name,
          cards: []
        };
      }
      enchantedBySet[setCode].cards.push(card);
    });

    // Sort the sets (numbered sets first, then others alphabetically)
    const sortedSetCodes = Object.keys(enchantedBySet).sort((a, b) => {
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      const aIsNum = !isNaN(aNum) && String(aNum) === a;
      const bIsNum = !isNaN(bNum) && String(bNum) === b;

      if (aIsNum && bIsNum) return aNum - bNum;
      if (aIsNum) return -1;
      if (bIsNum) return 1;
      return a.localeCompare(b);
    });

    // Sort cards in each set by foil price descending (fall back to standard price or name if foil is null)
    sortedSetCodes.forEach((setCode) => {
      enchantedBySet[setCode].cards.sort((a, b) => {
        const aPrice = a.usd_foil !== null ? a.usd_foil : (a.usd || 0);
        const bPrice = b.usd_foil !== null ? b.usd_foil : (b.usd || 0);
        if (bPrice !== aPrice) {
          return bPrice - aPrice;
        }
        // Fallback to collector number
        const aNum = parseInt(a.collector_number, 10);
        const bNum = parseInt(b.collector_number, 10);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return aNum - bNum;
        }
        return a.name.localeCompare(b.name);
      });
    });

    // Write raw data to top_priced_cards.json
    const rawDataPath = path.join(__dirname, 'top_priced_cards.json');
    await fs.writeFile(
      rawDataPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          regular: { top_standard: regularStandard, top_foil: regularFoil },
          promotional: { top_standard: promoStandard, top_foil: promoFoil },
          enchanted_by_set: sortedSetCodes.map((setCode) => ({
            set_code: enchantedBySet[setCode].code,
            set_name: enchantedBySet[setCode].name,
            cards: enchantedBySet[setCode].cards
          }))
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`Saved raw JSON data to: ${rawDataPath}`);

    // Generate Markdown output
    let markdown = `# 🏆 Disney Lorcana Weekly Top Priced Cards\n\n`;
    markdown += `*Last updated: ${new Date().toLocaleString()}*\n\n`;
    
    markdown += `This report compiles the top 10 most expensive standard (non-foil) and foil Disney Lorcana cards in separate lists for regular set releases and promotional/special releases, sourced from market data aggregated via the Lorcast API.\n\n`;

    // 1. Regular Standard
    markdown += `## 💵 Top 10 Standard (Non-Foil) Set Release Cards\n\n`;
    markdown += `| Rank | Card Name | Version | Set | Rarity | Price (USD) | Link |\n`;
    markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
    regularStandard.forEach((card, index) => {
      const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
      const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
      markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} (#${card.collector_number}) | ${card.rarity} | **$${card.usd.toFixed(2)}** | ${linkCol} |\n`;
    });
    markdown += `\n`;

    // 2. Regular Foil
    markdown += `## ✨ Top 10 Foil Set Release Cards\n\n`;
    markdown += `| Rank | Card Name | Version | Set | Rarity | Foil Price (USD) | Link |\n`;
    markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
    regularFoil.forEach((card, index) => {
      const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
      const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
      markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} (#${card.collector_number}) | ${card.rarity} | **$${card.usd_foil.toFixed(2)}** | ${linkCol} |\n`;
    });
    markdown += `\n`;

    // 3. Promo Standard
    markdown += `## 🎟️ Top 10 Standard (Non-Foil) Promotional Cards\n\n`;
    markdown += `| Rank | Card Name | Version | Set | Rarity | Price (USD) | Link |\n`;
    markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
    promoStandard.forEach((card, index) => {
      const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
      const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
      markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} (#${card.collector_number}) | ${card.rarity} | **$${card.usd.toFixed(2)}** | ${linkCol} |\n`;
    });
    markdown += `\n`;

    // 4. Promo Foil
    markdown += `## 🌟 Top 10 Foil Promotional Cards\n\n`;
    markdown += `| Rank | Card Name | Version | Set | Rarity | Foil Price (USD) | Link |\n`;
    markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
    promoFoil.forEach((card, index) => {
      const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
      const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
      markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} (#${card.collector_number}) | ${card.rarity} | **$${card.usd_foil.toFixed(2)}** | ${linkCol} |\n`;
    });
    markdown += `\n`;

    // 5. Enchanted & Iconic Cards by Set
    markdown += `## 💎 Enchanted & Iconic Card Prices by Set\n\n`;
    markdown += `This section lists all Enchanted and Iconic cards found in each set, sorted from most expensive to least expensive (foil market price).\n\n`;

    sortedSetCodes.forEach((setCode) => {
      const setData = enchantedBySet[setCode];
      markdown += `### ${setData.name} (${setData.code})\n\n`;
      markdown += `| Rank | Card Name | Version | Rarity | Price (USD) | Link |\n`;
      markdown += `| :---: | :--- | :--- | :---: | :---: | :--- |\n`;
      
      setData.cards.forEach((card, index) => {
        const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
        const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
        const price = card.usd_foil !== null 
          ? `**$${card.usd_foil.toFixed(2)}** (Foil)` 
          : (card.usd !== null ? `**$${card.usd.toFixed(2)}**` : '*N/A*');
          
        markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.rarity} | ${price} | ${linkCol} |\n`;
      });
      markdown += `\n`;
    });

    markdown += `\n---\n*Note: Prices represent the current market values on TCGPlayer and are subject to change. Card images are served directly from the official Lorcast CDN.*`;

    // Write markdown to top_priced_cards.md
    const markdownPath = path.join(__dirname, 'top_priced_cards.md');
    await fs.writeFile(markdownPath, markdown, 'utf8');
    console.log(`Saved Markdown summary to: ${markdownPath}`);

    console.log('\n=== Success! Lorcana price pulling complete. ===\n');
  } catch (error) {
    console.error('❌ Error during card price pulling:', error.message);
    process.exit(1);
  }
}

main();
