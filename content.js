chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT") {
    console.log("🔍 Extrahuje data z Cookidoo...");
    const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
    const imageTag = document.querySelector('img.recipe-card__image, img.core-tile__image, .recipe-card__image-container img');

    // Nové: Hledání obtížnosti přímo v HTML struktuře Cookidoo
    const difficultyEl = document.querySelector('rdp-difficulty p');
    const extractedDifficulty = difficultyEl ? difficultyEl.innerText.trim().toLowerCase() : "";
    console.log("📊 Nalezena obtížnost na stránce:", extractedDifficulty);

    if (jsonLdScript) {
      try {
        const data = JSON.parse(jsonLdScript.innerText);
        const recipe = Array.isArray(data) ? data.find(i => i["@type"] === "Recipe") : data;

        if (Array.isArray(recipe.recipeCategory)) {
            recipe.recipeCategory = recipe.recipeCategory.join(", ");
        }

        if (imageTag) recipe.extractedImage = imageTag.src;

        // Přidáme explicitně extrahovanou obtížnost do objektu
        recipe.manualDifficulty = extractedDifficulty;

        sendResponse({ data: recipe });
      } catch (e) { sendResponse({ data: null }); }
    }
  }

  if (request.action === "FILL") {
    fillFirstPage(request.data).then(() => {
        sendResponse({ success: true });
    });
    return true;
  }
});

/**
 * Logika pro stažení a otevření dialogu (beze změny)
 */
async function handleImage(url, name) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${name.replace(/\s+/g, '_')}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (e) { window.open(url, '_blank'); }

  setTimeout(() => {
    const fileInput = document.querySelector('input[type="file"].upload');
    if (fileInput) fileInput.click();
  }, 1500);
}

async function selectByContainer(containerSelector, targetText) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const trigger = container.querySelector('.v-input__slot');
  if (trigger) {
    trigger.click();
    await new Promise(r => setTimeout(r, 1000));
    const options = Array.from(document.querySelectorAll('.v-list-item__title'));
    const match = options.find(opt => opt.innerText.trim().toLowerCase() === targetText.toLowerCase());
    if (match) match.click();
    else document.body.click();
  }
  await new Promise(r => setTimeout(r, 500));
}

function setInputValue(selector, value, isXPath = false) {
  let element = isXPath
    ? document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    : document.querySelector(selector);

  if (element && value !== undefined && value !== "") {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

async function fillFirstPage(recipe) {
  console.log("🛠 Plním data...");

  setInputValue("div.create-recipe-title input", recipe.name);
  setInputValue("div.create-recipe-description textarea", `Imported from Cookidoo: ${recipe.name}`);

  const yieldText = String(recipe.recipeYield || "");
  const servingsMatch = yieldText.match(/\d+/);
  if (servingsMatch) setInputValue("div.serving-size-amount input", servingsMatch[0]);

  const parseDur = (d) => {
    const m = String(d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    return m ? (parseInt(m[1]||0)*60 + parseInt(m[2]||0)) : "";
  };
  setInputValue("//label[contains(text(), 'Doba přípravy')]/following-sibling::input", parseDur(recipe.prepTime), true);
  setInputValue("//label[contains(text(), 'Celkový čas')]/following-sibling::input", parseDur(recipe.totalTime), true);

  if (yieldText.toLowerCase().includes("porc")) {
    await selectByContainer(".serving-size-unit", "porcí");
  }
  await selectByContainer(".create-recipe-category", "Dezerty");

  // --- OPRAVENÁ LOGIKA NÁROČNOSTI ---
  let mcDifficulty = "Středně těžké"; // Default

  // Priorita 1: To, co jsme vyškrábli z HTML tagu <rdp-difficulty>
  // Priorita 2: To, co je v JSON datech (kdyby HTML tag nebyl nalezen)
  const sourceDiff = (recipe.manualDifficulty || recipe.recipeCategory || "").toLowerCase();

  console.log("🔍 Zdrojová data pro náročnost:", sourceDiff);

  if (sourceDiff.includes("snadné") || sourceDiff.includes("easy") || sourceDiff.includes("jednoduché")) {
      mcDifficulty = "Jednoduché";
  } else if (sourceDiff.includes("náročné") || sourceDiff.includes("advanced") || sourceDiff.includes("těžké")) {
      mcDifficulty = "Těžké";
  }

  console.log(`🎯 Cílová náročnost pro Monsieur Cuisine: ${mcDifficulty}`);

  const difficultySection = Array.from(document.querySelectorAll('.v-input')).find(el => el.innerText.includes('Obtížnost'));
  const searchArea = difficultySection || document.body;
  const diffButtons = Array.from(searchArea.querySelectorAll('.v-btn, h5, .v-chip, .v-btn__content'));

  const targetBtn = diffButtons.find(el => el.innerText.trim() === mcDifficulty);
  if (targetBtn) {
    targetBtn.click();
    console.log("✅ Náročnost nastavena.");
  }

  if (recipe.nutrition) {
    const nutMap = [
      { l: "Energetická hodnota", v: recipe.nutrition.calories },
      { l: "Bílkoviny", v: recipe.nutrition.proteinContent },
      { l: "Sacharidy", v: recipe.nutrition.carbohydrateContent },
      { l: "Tuk", v: recipe.nutrition.fatContent }
    ];
    nutMap.forEach(item => {
      const val = String(item.v || "").match(/\d+/);
      if (val) setInputValue(`//label[contains(text(), '${item.l}')]/following-sibling::input`, val[0], true);
    });
  }

  if (recipe.extractedImage) {
    await handleImage(recipe.extractedImage, recipe.name);
  }

  console.log("🏁 První stránka hotová.");
}