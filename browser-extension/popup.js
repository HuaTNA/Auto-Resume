let currentTab;
let selection = "";

async function initialize() {
  const saved = await chrome.storage.local.get("workspaceUrl");
  if (saved.workspaceUrl) document.querySelector("#workspace").value = saved.workspaceUrl;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    document.querySelector("#page").textContent = "此页面无法采集。";
    return;
  }
  document.querySelector("#page").textContent = tab.title || tab.url;
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.getSelection()?.toString().trim() || "" });
    selection = result[0]?.result || "";
  } catch { selection = ""; }
  document.querySelector("#save").disabled = false;
}

document.querySelector("#save").addEventListener("click", async () => {
  const workspace = document.querySelector("#workspace").value.replace(/\/$/, "");
  if (!/^https?:\/\//.test(workspace)) { document.querySelector("#status").textContent = "请输入有效的工作区地址。"; return; }
  await chrome.storage.local.set({ workspaceUrl: workspace });
  const params = new URLSearchParams({ new: "1", title: currentTab.title || currentTab.url, url: currentTab.url, content: selection.slice(0, 5000) });
  await chrome.tabs.create({ url: `${workspace}/knowledge?${params}` });
  window.close();
});

initialize();
