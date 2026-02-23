chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT") {
    console.log("🔍 Extrahuje data z Cookidoo...");
    const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
    const imageTag = document.querySelector('img.recipe-card__image, img.core-tile__image, .recipe-card__image-container img');

    const difficultyEl = document.querySelector('rdp-difficulty p');
    const extractedDifficulty = difficultyEl ? difficultyEl.innerText.trim().toLowerCase() : "";

    let htmlPrepTime = "";
    let htmlTotalTime = "";
    const cookParams = document.querySelectorAll('.recipe-card__cook-param');
    cookParams.forEach(param => {
      const text = param.innerText.trim();
      if (text.includes('Příprava')) htmlPrepTime = text.replace('Příprava', '').trim();
      if (text.includes('Celkový')) htmlTotalTime = text.replace('Celkový', '').trim();
    });

    if (jsonLdScript) {
      try {
        const data = JSON.parse(jsonLdScript.innerText);
        const recipe = Array.isArray(data) ? data.find(i => i["@type"] === "Recipe") : data;

        if (Array.isArray(recipe.recipeCategory)) {
            recipe.recipeCategory = recipe.recipeCategory.join(", ");
        }

        if (imageTag) recipe.extractedImage = imageTag.src;

        recipe.manualDifficulty = extractedDifficulty;
        recipe.htmlPrepTime = htmlPrepTime;
        recipe.htmlTotalTime = htmlTotalTime;
        recipe.ingredients = recipe.recipeIngredient || [];

        let steps = [];
        if (Array.isArray(recipe.recipeInstructions)) {
          recipe.recipeInstructions.forEach(item => {
            if (item["@type"] === "HowToSection") {
              const sectionName = item.name;
              item.itemListElement.forEach((step, index) => {
                steps.push({
                  title: index === 0 ? sectionName : `Krok ${index + 1}`,
                  text: step.text.replace(/<[^>]*>?/gm, '')
                });
              });
            } else if (item["@type"] === "HowToStep") {
              steps.push({
                title: `Krok ${steps.length + 1}`,
                text: item.text.replace(/<[^>]*>?/gm, '')
              });
            } else if (typeof item === 'string') {
              steps.push({
                title: `Krok ${steps.length + 1}`,
                text: item
              });
            }
          });
        }
        recipe.steps = steps;

        sendResponse({ data: recipe });
      } catch (e) {
        console.error("Extraction error:", e);
        sendResponse({ data: null });
      }
    }
  }

  if (request.action === "FILL") {
    fillRecipe(request.data).then(() => {
        sendResponse({ success: true });
    });
    return true;
  }
});

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForElement(selector, isXPath = false, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = isXPath
      ? document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      : document.querySelector(selector);
    if (el) return el;
    await delay(100);
  }
  return null;
}

// Hyper-deliberate typing to force framework state updates
async function typeValue(element, value) {
  if (!element) return;
  element.focus();
  element.click();
  await delay(100);

  // Clear field via selection to trigger Vue's observers
  element.select();
  document.execCommand('delete', false, null);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(50);

  // Inject value
  document.execCommand('insertText', false, String(value || ""));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await delay(100);

  // Commit value
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  await delay(150);

  element.blur();
  await delay(150);
}

async function clickNext() {
  const nextBtn = await waitForElement("//button[contains(., 'Dále')]", true);
  if (nextBtn) {
    nextBtn.click();
    await delay(2000);
    return true;
  }
  return false;
}

function parseTime(isoDur, htmlTime) {
  if (isoDur) {
    const m = String(isoDur).match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (m) {
      const hours = parseInt(m[1] || 0);
      const mins = parseInt(m[2] || 0);
      if (hours > 0 || mins > 0) return hours * 60 + mins;
    }
  }

  if (htmlTime) {
    let totalMinutes = 0;
    const hourMatch = htmlTime.match(/(\d+)\s*hod/);
    const minMatch = htmlTime.match(/(\d+)\s*min/);
    if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
    if (minMatch) totalMinutes += parseInt(minMatch[1]);
    return totalMinutes > 0 ? totalMinutes : "";
  }

  return "";
}

function mapUnit(unit) {
  if (!unit) return null;
  const u = unit.toLowerCase();

  // Mapping to user-provided list
  if (u === "g" || u.includes("gram")) return "g";
  if (u.includes("lžíc") && !u.includes("lžič")) {
    if (u.includes("ek") || u.includes("ic")) return "lžic";
    return "lžíce";
  }
  if (u.includes("lžič")) {
    if (u.includes("ek")) return "lžiček";
    if (u.includes("ky")) return "lžičky";
    return "lžička";
  }
  if (u.includes("špet")) {
    if (u.includes("ek")) return "špetek";
    if (u.includes("ky")) return "špetky";
    return "špetka";
  }
  if (u.includes("špič")) {
    if (u.includes("ek")) return "špiček nože";
    if (u.includes("ky")) return "špičky nože";
    return "špičku nože";
  }
  if (u.includes("vanič")) {
    if (u.includes("ek")) return "vaniček";
    if (u.includes("ky")) return "vaničky";
    return "vanička";
  }
  return null;
}

function parseIngredient(str) {
  const units = [
    "gramů", "gramy", "g",
    "mililitrů", "ml",
    "kilogramů", "kg",
    "litrů", "l",
    "polévková lžíce", "polévkové lžíce", "lžíc", "lžíce",
    "čajová lžička", "čajové lžičky", "lžiček", "lžička", "lžičky",
    "ks", "kusy", "kusů", "kus",
    "balíček", "balíčky", "balíčků",
    "špetka", "špetky", "špetek",
    "špička nože", "špičku nože", "špičky nože", "špiček nože",
    "vanička", "vaničky", "vaniček",
    "hrst", "hrsti"
  ];
  units.sort((a, b) => b.length - a.length);

  let amount = "";
  let unit = "";
  let name = str;

  const firstWordMatch = str.match(/^([\d\s,.\/½⅓⅔¼¾]+)(.*)$/);
  if (firstWordMatch) {
    amount = firstWordMatch[1].trim();
    let rest = firstWordMatch[2].trim();

    for (const u of units) {
      if (rest.toLowerCase().startsWith(u.toLowerCase())) {
        unit = u;
        name = rest.substring(u.length).trim();
        if (name.startsWith(',') || name.startsWith('.')) name = name.substring(1).trim();
        return { amount, unit, name };
      }
    }
    name = rest;
  }

  return { amount, unit, name };
}

async function fillTimeFields(labelXPath, totalMinutes) {
  if (totalMinutes === "" || isNaN(totalMinutes)) return;

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  const labelEl = document.evaluate(labelXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (labelEl) {
    const colParent = labelEl.closest('.col');
    if (colParent) {
      const timeFieldContainer = colParent.querySelector('.parameter-time-field');
      if (timeFieldContainer) {
        const inputs = timeFieldContainer.querySelectorAll('input[type="number"]');
        if (inputs.length >= 2) {
          await typeValue(inputs[0], hours);
          await typeValue(inputs[1], mins);
        }
      }
    }
  }
}

async function fillRecipe(recipe) {
  console.log("🚀 Zahajuji plnění receptu...");

  // PAGE 1: Detaily receptu
  await fillFirstPage(recipe);
  await clickNext();

  // PAGE 2: Doba
  console.log("🛠 Plním dobu...");
  await waitForElement("//h4[contains(., 'Doba')]", true);
  const prepMinutes = parseTime(recipe.prepTime, recipe.htmlPrepTime);
  const totalMinutes = parseTime(recipe.totalTime, recipe.htmlTotalTime);
  await fillTimeFields("//h5[contains(., 'Příprava')]", prepMinutes);
  await fillTimeFields("//h3[contains(., 'Hotové za')]", totalMinutes);
  await clickNext();

  // PAGE 3: Suroviny
  console.log("🛠 Plním suroviny...");
  await waitForElement("//h4[contains(., 'Suroviny')]", true);

  const ings = recipe.ingredients || [];
  for (let i = 0; i < ings.length; i++) {
    const parsed = parseIngredient(ings[i]);
    console.log(`Processing ingredient ${i + 1}/${ings.length}:`, parsed);

    // Close any previous row dropdowns before adding new row
    document.body.click();
    await delay(300);

    const addIngBtn = document.evaluate("//button[contains(., 'Přidat suroviny')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (addIngBtn) {
      const initialCount = document.querySelectorAll('.ingredient-wrapper').length;
      addIngBtn.click();

      // Wait for new row
      let waitAttempt = 0;
      while (document.querySelectorAll('.ingredient-wrapper').length <= initialCount && waitAttempt < 40) {
        await delay(100);
        waitAttempt++;
      }

      const lastIdx = document.querySelectorAll('.ingredient-wrapper').length - 1;

      try {
        const mappedUnit = mapUnit(parsed.unit);
        let finalName = parsed.name;
        if (parsed.unit && !mappedUnit) finalName = `${parsed.unit} ${parsed.name}`.trim();

        // 1. Fill Name
        let nameRow = document.querySelectorAll('.ingredient-wrapper')[lastIdx];
        let nameInp = nameRow?.querySelector('input[placeholder="Surovina"]');
        if (nameInp) {
          console.log("  - Typing name:", finalName);
          await typeValue(nameInp, finalName);
        }

        // 2. Fill Amount
        let amountRow = document.querySelectorAll('.ingredient-wrapper')[lastIdx];
        let amountInp = amountRow?.querySelector('input[placeholder="0"]');
        if (amountInp && parsed.amount) {
          console.log("  - Typing amount:", parsed.amount);
          await typeValue(amountInp, parsed.amount);
        }

        // 3. Select Unit
        if (mappedUnit) {
          let unitRow = document.querySelectorAll('.ingredient-wrapper')[lastIdx];
          let unitSelect = unitRow?.querySelector('.col-md-3.col-8 .v-input__slot');
          if (unitSelect) {
            console.log("  - Selecting unit:", mappedUnit);
            unitSelect.click();
            await delay(1500);

            // Find ALL visible menus, then pick the one with highest z-index
            const menus = Array.from(document.querySelectorAll('.v-menu__content'))
              .filter(m => m.offsetParent !== null && window.getComputedStyle(m).display !== 'none');

            menus.sort((a, b) => (parseInt(window.getComputedStyle(b).zIndex) || 0) - (parseInt(window.getComputedStyle(a).zIndex) || 0));

            const activeMenu = menus[0];
            if (activeMenu) {
              const options = Array.from(activeMenu.querySelectorAll('.v-list-item, .v-list-item__title'));
              const match = options.find(opt => opt.innerText.trim().toLowerCase() === mappedUnit.toLowerCase());
              if (match) {
                match.click();
                console.log("  - Unit clicked");
              } else {
                console.warn(`  - Unit "${mappedUnit}" not in menu. Found:`, options.map(o => o.innerText.trim()));
                document.body.click();
              }
            } else {
              document.body.click();
            }
            await delay(600);
          }
        }
      } catch (e) {
        console.error("Error in row processing:", e);
      }
    }
  }
  await clickNext();

  // PAGE 4: Kroky
  console.log("🛠 Plním kroky...");
  await waitForElement("//h4[contains(., 'Kroky')]", true);

  for (const step of recipe.steps) {
    const addStepBtn = document.evaluate("//button[contains(., 'Přidat krok')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (addStepBtn) {
      addStepBtn.click();
      await delay(1500);
      const titleInp = await waitForElement("input[placeholder='např. připravit cibuli.']");
      const descInp = await waitForElement("textarea[placeholder='např. oloupat cibuli a nakrájet ji na tenká kolečka']");
      if (titleInp) await typeValue(titleInp, step.title);
      if (descInp) await typeValue(descInp, step.text);
      await delay(500);
      const saveBtn = document.evaluate("//button[contains(., 'Přidat') or contains(., 'Uložit')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (saveBtn) {
        saveBtn.click();
        await delay(1500);
      }
    }
  }
  console.log("🏁 Dokončeno.");
}

async function fillFirstPage(recipe) {
  console.log("🛠 Plním první stránku...");
  await waitForElement("div.create-recipe-title input");
  const titleInp = document.querySelector("div.create-recipe-title input");
  if (titleInp) await typeValue(titleInp, recipe.name);

  const descInp = document.querySelector("div.create-recipe-description textarea");
  if (descInp) await typeValue(descInp, `Imported from Cookidoo: ${recipe.name}`);

  const yieldText = String(recipe.recipeYield || "");
  const servingsMatch = yieldText.match(/\d+/);
  if (servingsMatch) {
    const yieldInp = document.querySelector("div.serving-size-amount input");
    if (yieldInp) await typeValue(yieldInp, servingsMatch[0]);
  }

  if (yieldText.toLowerCase().includes("porc")) await selectByContainer(".serving-size-unit", "porcí");
  await selectByContainer(".create-recipe-category", "Dezerty");

  let mcDifficulty = "Středně těžké";
  const sourceDiff = (recipe.manualDifficulty || "").toLowerCase();
  if (sourceDiff.includes("snadné") || sourceDiff.includes("easy") || sourceDiff.includes("jednoduché")) mcDifficulty = "Jednoduché";
  else if (sourceDiff.includes("náročné") || sourceDiff.includes("advanced") || sourceDiff.includes("těžké")) mcDifficulty = "Těžké";

  const diffButtons = Array.from(document.querySelectorAll('.v-btn, .v-chip, .v-btn__content'));
  const targetBtn = diffButtons.find(el => el.innerText.trim() === mcDifficulty);
  if (targetBtn) targetBtn.click();

  if (recipe.nutrition) {
    const nutMap = [{ l: "Energetická hodnota", v: recipe.nutrition.calories }, { l: "Bílkoviny", v: recipe.nutrition.proteinContent }, { l: "Sacharidy", v: recipe.nutrition.carbohydrateContent }, { l: "Tuk", v: recipe.nutrition.fatContent }];
    for (const item of nutMap) {
      const val = String(item.v || "").match(/\d+/);
      if (val) {
        const label = Array.from(document.querySelectorAll('label')).find(l => l.innerText.includes(item.l));
        const input = label?.parentElement?.querySelector('input');
        if (input) await typeValue(input, val[0]);
      }
    }
  }
  if (recipe.extractedImage) await handleImage(recipe.extractedImage, recipe.name);
}

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
  } catch (e) { console.warn("Image fail", e); }
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
    await delay(1000);
    const options = Array.from(document.querySelectorAll('.v-list-item__title'));
    const match = options.find(opt => opt.innerText.trim().toLowerCase() === targetText.toLowerCase());
    if (match) match.click();
    else document.body.click();
  }
  await delay(500);
}
