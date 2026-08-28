from __future__ import annotations

from typing import Any, Sequence

from .browser import Control


class PlaywrightPage:
    """Synchronous Playwright managed/CDP bridge without a hard dependency.

    OpenClaw ``existing-session`` profiles require snapshot refs and should use
    a separate BrowserPage implementation backed by the official browser tool.
    """

    def __init__(self, page: Any) -> None:
        self._page = page

    @property
    def url(self) -> str:
        return self._page.url

    def goto(self, url: str) -> None:
        self._page.goto(url, wait_until="domcontentloaded")

    def content_text(self) -> str:
        return self._page.locator("body").inner_text()

    def controls(self) -> Sequence[Control]:
        raw = self._page.locator("input, textarea, select, button").evaluate_all(
            """els => els.filter(el => !el.disabled).map((el, i) => {
              if (!el.dataset.applicationExecutorId) el.dataset.applicationExecutorId = `ae-${i}`;
              const id = el.id;
              const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
              const wrapping = el.closest('label');
              const label = explicit?.innerText || wrapping?.innerText ||
                el.getAttribute('aria-label') || el.placeholder || el.value || '';
              return {
                locator: `[data-application-executor-id="${el.dataset.applicationExecutorId}"]`,
                kind: el.tagName === 'TEXTAREA' ? 'textarea' :
                  el.tagName === 'SELECT' ? 'select' :
                  el.tagName === 'BUTTON' ? (el.type === 'submit' ? 'submit' : 'button') :
                  (el.type || 'text'),
                name: el.name || '', label: label.trim(), required: !!el.required,
                options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text) : []
              };
            })"""
        )
        controls = []
        for item in raw:
            values = dict(item)
            values["options"] = tuple(values.get("options", ()))
            controls.append(Control(**values))
        return tuple(controls)

    def fill(self, locator: str, value: str) -> None:
        self._page.locator(locator).fill(value)

    def check(self, locator: str, checked: bool) -> None:
        self._page.locator(locator).set_checked(checked)

    def select(self, locator: str, value: str) -> None:
        self._page.locator(locator).select_option(label=value)

    def upload(self, locator: str, path: str) -> None:
        self._page.locator(locator).set_input_files(path)

    def click(self, locator: str) -> None:
        self._page.locator(locator).click()

    def wait_for_settled(self) -> None:
        self._page.wait_for_load_state("domcontentloaded")
