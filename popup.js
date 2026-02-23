document.getElementById('extractBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes("cookidoo.cz")) {
    updateStatus("Error: Not on Cookidoo!");
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: "EXTRACT" }, (response) => {
    if (response && response.data) {
      chrome.storage.local.set({ recipeData: response.data }, () => {
        updateStatus("Recipe saved! Now go to Monsieur.");
      });
    } else {
      updateStatus("Failed to find recipe data.");
    }
  });
});

document.getElementById('fillBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes("monsieur-cuisine.com")) {
    updateStatus("Error: Not on Monsieur Cuisine!");
    return;
  }

  chrome.storage.local.get("recipeData", (result) => {
    if (result.recipeData) {
      updateStatus("Filling recipe... Please wait.");
      chrome.tabs.sendMessage(tab.id, { action: "FILL", data: result.recipeData }, (res) => {
        if (res && res.success) {
          updateStatus("Recipe filled successfully!");
        } else {
          updateStatus("Filling might have been interrupted.");
        }
      });
    } else {
      updateStatus("No recipe data found. Extract first.");
    }
  });
});

function updateStatus(text) {
  document.getElementById('statusText').innerText = text;
}