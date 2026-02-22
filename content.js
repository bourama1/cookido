chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT") {
    // Locate the JSON-LD script containing recipe details
    const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
    if (jsonLdScript) {
      try {
        const data = JSON.parse(jsonLdScript.innerText);
        // Sometimes the JSON is an array, we want the Recipe object
        const recipe = Array.isArray(data) ? data.find(i => i["@type"] === "Recipe") : data;
        sendResponse({ data: recipe });
      } catch (e) {
        sendResponse({ data: null });
      }
    }
  }

  if (request.action === "FILL") {
    const recipe = request.data;
    fillFirstPage(recipe);
    sendResponse({ success: true });
  }
});

/**
 * Helper to input values into Vue.js/Vuetify fields so the app registers changes.
 */
function setInputValue(selector, value, isXPath = false) {
  let element;
  if (isXPath) {
    element = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } else {
    element = document.querySelector(selector);
  }

  if (element) {
    element.value = value;
    // Trigger events so the website knows the data changed
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    return true;
  }
  return false;
}

function extractNumber(text) {
  if (!text) return "";
  const match = String(text).match(/\d+/);
  return match ? match[0] : "";
}

function fillFirstPage(recipe) {
  // 1. Title
  setInputValue("div.create-recipe-title input", recipe.name);

  // 2. Description
  setInputValue("div.create-recipe-description textarea", `Imported from Cookidoo: ${recipe.name}`);

  // 3. Servings (Yield)
  const servings = extractNumber(recipe.recipeYield);
  setInputValue("div.serving-size-amount input", servings);

  // 4. Nutrition Info
  if (recipe.nutrition) {
    const nut = recipe.nutrition;
    // Map Monsieur labels to Cookidoo keys
    const nutMap = [
      { label: "Energetická hodnota", val: extractNumber(nut.calories) },
      { label: "Bílkoviny", val: extractNumber(nut.proteinContent) },
      { label: "Sacharidy", val: extractNumber(nut.carbohydrateContent) },
      { label: "Tuk", val: extractNumber(nut.fatContent) }
    ];

    nutMap.forEach(item => {
      if (item.val) {
        const xpath = `//label[contains(text(), '${item.label}')]/following-sibling::input`;
        setInputValue(xpath, item.val, true);
      }
    });
  }
}