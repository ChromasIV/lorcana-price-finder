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
    const headers = { 
      ...options.headers, 
      'Connection': 'close',
      'User-Agent': 'TCGPriceFinder/1.0.0'
    };
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

// Helper to determine if a Lorcana card is a promotional / special release card
function isLorcanaPromo(card) {
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

// Helper to determine if a Riftbound card is from a promotional / special set
function isRiftboundPromo(card) {
  const setName = card.set_name.toLowerCase();
  return (
    setName.includes('promo') ||
    setName.includes('judge') ||
    setName.includes('organized play') ||
    setName.includes('worlds bundle')
  );
}

async function main() {
  console.log('=== TCG Price Finder ===');
  console.log('Timestamp:', new Date().toLocaleString());

  // ==========================================
  // PART 1: LORCANA PULLING
  // ==========================================
  console.log('\n--- Fetching Disney Lorcana Prices ---');
  console.log('Fetching all active Lorcana sets from Lorcast API...');
  
  let regularStandard = [];
  let regularFoil = [];
  let promoStandard = [];
  let promoFoil = [];
  let sortedSetCodes = [];
  const enchantedBySet = {};

  try {
    const setsResponse = await fetchWithRetry('https://api.lorcast.com/v0/sets');
    const setsData = await setsResponse.json();
    const sets = setsData.results || [];
    console.log(`Successfully retrieved ${sets.length} Lorcana sets.`);

    let allLorcanaCards = [];

    // Fetch cards for each set with a delay to respect rate limiting (Lorcast requests 50-100ms)
    for (const [index, set] of sets.entries()) {
      console.log(`[Lorcana ${index + 1}/${sets.length}] Fetching cards for set: ${set.name} (${set.code})...`);
      
      try {
        const cardsResponse = await fetchWithRetry(`https://api.lorcast.com/v0/sets/${set.code}/cards`);
        const cardsData = await cardsResponse.json();
        allLorcanaCards = allLorcanaCards.concat(cardsData);
        console.log(`   -> Retrieved ${cardsData.length} cards.`);
      } catch (err) {
        console.warn(`⚠️ Warning: Failed to fetch cards for Lorcana set ${set.code}: ${err.message}. Skipping.`);
      }

      await delay(200);
    }

    console.log(`Total Lorcana cards successfully fetched: ${allLorcanaCards.length}`);

    if (allLorcanaCards.length > 0) {
      // Parse and filter Lorcana cards
      const processedLorcana = allLorcanaCards.map((card) => {
        const usdPrice = card.prices?.usd ? parseFloat(card.prices.usd) : null;
        const usdFoilPrice = card.prices?.usd_foil ? parseFloat(card.prices.usd_foil) : null;
        
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

      const regularCards = processedLorcana.filter(c => !isLorcanaPromo(c));
      const promoCards = processedLorcana.filter(c => isLorcanaPromo(c));

      // Regular lists
      regularStandard = regularCards
        .filter((c) => c.usd !== null && !isNaN(c.usd))
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 10);

      regularFoil = regularCards
        .filter((c) => c.usd_foil !== null && !isNaN(c.usd_foil))
        .sort((a, b) => b.usd_foil - a.usd_foil)
        .slice(0, 10);

      // Promo lists
      promoStandard = promoCards
        .filter((c) => c.usd !== null && !isNaN(c.usd))
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 10);

      promoFoil = promoCards
        .filter((c) => c.usd_foil !== null && !isNaN(c.usd_foil))
        .sort((a, b) => b.usd_foil - a.usd_foil)
        .slice(0, 10);

      // Group Enchanted & Iconic Cards
      const enchantedCards = processedLorcana.filter(
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

      sortedSetCodes = Object.keys(enchantedBySet).sort((a, b) => {
        const aNum = parseInt(a, 10);
        const bNum = parseInt(b, 10);
        const aIsNum = !isNaN(aNum) && String(aNum) === a;
        const bIsNum = !isNaN(bNum) && String(bNum) === b;

        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return a.localeCompare(b);
      });

      sortedSetCodes.forEach((setCode) => {
        enchantedBySet[setCode].cards.sort((a, b) => {
          const aPrice = a.usd_foil !== null ? a.usd_foil : (a.usd || 0);
          const bPrice = b.usd_foil !== null ? b.usd_foil : (b.usd || 0);
          if (bPrice !== aPrice) return bPrice - aPrice;
          const aNum = parseInt(a.collector_number, 10);
          const bNum = parseInt(b.collector_number, 10);
          if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
          return a.name.localeCompare(b.name);
        });
      });
    }
  } catch (error) {
    console.error('❌ Error fetching Lorcana data:', error.message);
  }

  // ==========================================
  // PART 2: RIFTBOUND PULLING (TCGCSV)
  // ==========================================
  console.log('\n--- Fetching Riftbound TCG Prices ---');
  console.log('Fetching active Riftbound sets from TCGCSV...');

  let regularRiftStandard = [];
  let regularRiftFoil = [];
  let promoRiftStandard = [];
  let promoRiftFoil = [];
  let sortedRiftSetCodes = [];
  const showcaseBySet = {};

  try {
    const riftGroupsRes = await fetchWithRetry('https://tcgcsv.com/tcgplayer/89/groups');
    const riftGroupsData = await riftGroupsRes.json();
    const riftGroups = riftGroupsData.results || [];
    console.log(`Successfully retrieved ${riftGroups.length} Riftbound groups.`);

    let allRiftboundCards = [];

    // Fetch sets, cards and prices
    for (const [index, group] of riftGroups.entries()) {
      console.log(`[Riftbound ${index + 1}/${riftGroups.length}] Fetching set: ${group.name} (${group.groupId})...`);
      
      try {
        const prodRes = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/89/${group.groupId}/products`);
        const prodData = await prodRes.json();

        await delay(200);

        const priceRes = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/89/${group.groupId}/prices`);
        const priceData = await priceRes.json();

        // Map prices
        const pricesMap = {};
        if (priceData.results) {
          priceData.results.forEach(p => {
            const priceVal = p.marketPrice || p.midPrice || p.lowPrice || null;
            if (!pricesMap[p.productId]) {
              pricesMap[p.productId] = {};
            }
            if (p.subTypeName.toLowerCase() === 'normal') {
              pricesMap[p.productId].normal = priceVal;
            } else if (p.subTypeName.toLowerCase() === 'foil') {
              pricesMap[p.productId].foil = priceVal;
            }
          });
        }

        // Process products that are actual cards
        const groupCards = (prodData.results || [])
          .filter(p => {
            const name = p.name.toLowerCase();
            return (
              p.extendedData && p.extendedData.length > 0 &&
              !name.includes('booster') &&
              !name.includes('box') &&
              !name.includes('deck') &&
              !name.includes('display') &&
              !name.includes('bundle') &&
              !name.includes('pack')
            );
          })
          .map(card => {
            const rarityItem = card.extendedData.find(d => d.name === 'Rarity');
            const rarity = rarityItem ? rarityItem.value : 'Common';

            const numItem = card.extendedData.find(d => d.name === 'Number');
            const collectorNumber = numItem ? numItem.value : 'N/A';

            let version = 'N/A';
            if (card.name.includes('(')) {
              const match = card.name.match(/\(([^)]+)\)/);
              if (match) version = match[1];
            } else if (card.name.includes(' - ')) {
              const parts = card.name.split(' - ');
              if (parts.length > 1) version = parts[1];
            }

            const cardPrices = pricesMap[card.productId] || {};
            const usdPrice = cardPrices.normal !== undefined ? cardPrices.normal : null;
            const usdFoilPrice = cardPrices.foil !== undefined ? cardPrices.foil : null;

            return {
              id: `rift_${card.productId}`,
              name: card.name,
              version: version,
              rarity: rarity,
              set_code: group.abbreviation || String(group.groupId),
              set_name: group.name,
              usd: usdPrice,
              usd_foil: usdFoilPrice,
              image_url: card.imageUrl || '',
              purchase_url: card.url || '',
              collector_number: collectorNumber
            };
          });

        allRiftboundCards = allRiftboundCards.concat(groupCards);
        console.log(`   -> Processed ${groupCards.length} cards.`);
      } catch (err) {
        console.warn(`⚠️ Warning: Failed to fetch data for Riftbound set ${group.name} (${group.groupId}): ${err.message}. Skipping.`);
      }

      await delay(200);
    }

    console.log(`Total Riftbound cards successfully fetched: ${allRiftboundCards.length}`);

    if (allRiftboundCards.length > 0) {
      const regularRiftCards = allRiftboundCards.filter(c => !isRiftboundPromo(c));
      const promoRiftCards = allRiftboundCards.filter(c => isRiftboundPromo(c));

      // Regular lists
      regularRiftStandard = regularRiftCards
        .filter((c) => c.usd !== null && !isNaN(c.usd))
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 10);

      regularRiftFoil = regularRiftCards
        .filter((c) => c.usd_foil !== null && !isNaN(c.usd_foil))
        .sort((a, b) => b.usd_foil - a.usd_foil)
        .slice(0, 10);

      // Promo lists
      promoRiftStandard = promoRiftCards
        .filter((c) => c.usd !== null && !isNaN(c.usd))
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 10);

      promoRiftFoil = promoRiftCards
        .filter((c) => c.usd_foil !== null && !isNaN(c.usd_foil))
        .sort((a, b) => b.usd_foil - a.usd_foil)
        .slice(0, 10);

      // Group Showcase & Signature Cards
      const showcaseCards = allRiftboundCards.filter(
        (c) => c.rarity.toLowerCase() === 'showcase' || 
               c.name.toLowerCase().includes('showcase') || 
               c.name.toLowerCase().includes('signature')
      );

      showcaseCards.forEach((card) => {
        const setCode = card.set_code;
        if (!showcaseBySet[setCode]) {
          showcaseBySet[setCode] = {
            code: setCode,
            name: card.set_name,
            cards: []
          };
        }
        showcaseBySet[setCode].cards.push(card);
      });

      sortedRiftSetCodes = Object.keys(showcaseBySet).sort((a, b) => {
        const idxA = riftGroups.findIndex(g => g.abbreviation === a || String(g.groupId) === a);
        const idxB = riftGroups.findIndex(g => g.abbreviation === b || String(g.groupId) === b);
        if (idxA !== -1 && idxB !== -1) {
          return idxA - idxB; // Maintain chronological order of release sets
        }
        return a.localeCompare(b);
      });

      sortedRiftSetCodes.forEach((setCode) => {
        showcaseBySet[setCode].cards.sort((a, b) => {
          const aPrice = a.usd_foil !== null ? a.usd_foil : (a.usd || 0);
          const bPrice = b.usd_foil !== null ? b.usd_foil : (b.usd || 0);
          if (bPrice !== aPrice) return bPrice - aPrice;
          return a.name.localeCompare(b.name);
        });
      });
    }

  } catch (error) {
    console.error('❌ Error fetching Riftbound data:', error.message);
  }

  // ==========================================
  // PART 3: OUTPUT WRITING
  // ==========================================
  console.log('\n--- Writing Output Files ---');
  
  // A. JSON Raw Output
  const rawDataPath = path.join(__dirname, 'top_priced_cards.json');
  await fs.writeFile(
    rawDataPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        lorcana: {
          regular: { top_standard: regularStandard, top_foil: regularFoil },
          promotional: { top_standard: promoStandard, top_foil: promoFoil },
          enchanted_by_set: sortedSetCodes.map((setCode) => ({
            set_code: enchantedBySet[setCode].code,
            set_name: enchantedBySet[setCode].name,
            cards: enchantedBySet[setCode].cards
          }))
        },
        riftbound: {
          regular: { top_standard: regularRiftStandard, top_foil: regularRiftFoil },
          promotional: { top_standard: promoRiftStandard, top_foil: promoRiftFoil },
          showcase_by_set: sortedRiftSetCodes.map((setCode) => ({
            set_code: showcaseBySet[setCode].code,
            set_name: showcaseBySet[setCode].name,
            cards: showcaseBySet[setCode].cards
          }))
        }
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`Saved raw JSON data to: ${rawDataPath}`);

  // B. Markdown Output
  let markdown = `# 🏆 TCG Weekly Top Priced Cards\n\n`;
  markdown += `*Last updated: ${new Date().toLocaleString()}*\n\n`;
  markdown += `This report compiles card prices for **Disney Lorcana** and **Riftbound TCG**, sourced from market data aggregated via Lorcast API and TCGCSV (TCGPlayer Mirror).\n\n`;

  // Lorcana Section
  markdown += `# 🌀 Disney Lorcana\n\n`;

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

  // 5. Enchanted & Iconic
  markdown += `## 💎 Enchanted & Iconic Card Prices by Set\n\n`;
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

  // Riftbound Section
  markdown += `# ⚡ Riftbound TCG\n\n`;

  // 1. Regular Standard
  markdown += `## 💵 Top 10 Standard (Non-Foil) Set Release Cards\n\n`;
  markdown += `| Rank | Card Name | Version | Set | Rarity | Price (USD) | Link |\n`;
  markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
  regularRiftStandard.forEach((card, index) => {
    const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
    const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
    markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} | ${card.rarity} | **$${card.usd.toFixed(2)}** | ${linkCol} |\n`;
  });
  markdown += `\n`;

  // 2. Regular Foil
  markdown += `## ✨ Top 10 Foil Set Release Cards\n\n`;
  markdown += `| Rank | Card Name | Version | Set | Rarity | Foil Price (USD) | Link |\n`;
  markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
  regularRiftFoil.forEach((card, index) => {
    const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
    const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
    markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} | ${card.rarity} | **$${card.usd_foil.toFixed(2)}** | ${linkCol} |\n`;
  });
  markdown += `\n`;

  // 3. Promo Standard
  markdown += `## 🎟️ Top 10 Standard (Non-Foil) Promotional Cards\n\n`;
  markdown += `| Rank | Card Name | Version | Set | Rarity | Price (USD) | Link |\n`;
  markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
  promoRiftStandard.forEach((card, index) => {
    const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
    const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
    markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} | ${card.rarity} | **$${card.usd.toFixed(2)}** | ${linkCol} |\n`;
  });
  markdown += `\n`;

  // 4. Promo Foil
  markdown += `## 🌟 Top 10 Foil Promotional Cards\n\n`;
  markdown += `| Rank | Card Name | Version | Set | Rarity | Foil Price (USD) | Link |\n`;
  markdown += `| :---: | :--- | :--- | :--- | :--- | :---: | :--- |\n`;
  promoRiftFoil.forEach((card, index) => {
    const nameCol = card.image_url ? `[${card.name}](${card.image_url})` : card.name;
    const linkCol = card.purchase_url ? `[Buy on TCGPlayer](${card.purchase_url})` : 'N/A';
    markdown += `| ${index + 1} | **${nameCol}** | ${card.version} | ${card.set_name} | ${card.rarity} | **$${card.usd_foil.toFixed(2)}** | ${linkCol} |\n`;
  });
  markdown += `\n`;

  // 5. Showcase & Signature
  markdown += `## 💎 Showcase & Signature Card Prices by Set\n\n`;
  sortedRiftSetCodes.forEach((setCode) => {
    const setData = showcaseBySet[setCode];
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

  markdown += `\n---\n*Note: Prices represent the current market values on TCGPlayer and are subject to change. Card images are served directly from the official developer assets or TCGPlayer CDN.*`;

  // Write markdown to top_priced_cards.md
  const markdownPath = path.join(__dirname, 'top_priced_cards.md');
  await fs.writeFile(markdownPath, markdown, 'utf8');
  console.log(`Saved Markdown summary to: ${markdownPath}`);

  console.log('\n=== Success! TCG price finder complete. ===\n');
}

main().catch((err) => {
  console.error('❌ Error during price finder execution:', err.message);
  process.exit(1);
});
