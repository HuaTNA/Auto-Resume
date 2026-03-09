"""
templates.py
Manages resume LaTeX templates for different industries/styles.
"""

from pathlib import Path

TEMPLATE_DIR = Path(__file__).parent.parent / "data"

# Registry: name -> (filename, description)
TEMPLATES = {
    "classic": ("template.tex", "Clean classic style - good for most tech roles"),
    "modern": ("template_modern.tex", "Modern style with blue accents - stands out visually"),
    "consulting": ("template_consulting.tex", "Conservative layout - consulting, finance, PM roles"),
}

DEFAULT_TEMPLATE = "classic"


def list_templates() -> list[dict]:
    """Return list of available templates with metadata."""
    result = []
    for name, (filename, desc) in TEMPLATES.items():
        path = TEMPLATE_DIR / filename
        result.append({
            "name": name,
            "description": desc,
            "path": str(path),
            "exists": path.exists(),
        })
    return result


def get_template(name: str = None) -> str:
    """Load and return template content by name. Defaults to classic."""
    name = name or DEFAULT_TEMPLATE
    if name not in TEMPLATES:
        raise ValueError(f"Unknown template '{name}'. Available: {', '.join(TEMPLATES.keys())}")

    filename = TEMPLATES[name][0]
    path = TEMPLATE_DIR / filename
    return path.read_text(encoding="utf-8")


def print_template_list():
    """Pretty-print available templates."""
    templates = list_templates()
    print(f"\n  Available templates:")
    for t in templates:
        marker = "*" if t["name"] == DEFAULT_TEMPLATE else " "
        status = "" if t["exists"] else " [MISSING]"
        print(f"    {marker} {t['name']:12s} - {t['description']}{status}")
    print(f"  (* = default)\n")
