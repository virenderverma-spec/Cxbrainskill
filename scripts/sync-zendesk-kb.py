#!/usr/bin/env python3
"""
Sync Zendesk Help Center KB articles to a local consolidated markdown file.

Usage:
    python3 scripts/sync-zendesk-kb.py

Output:
    zendesk-kb-consolidated.md (in project root)

This fetches ALL articles from the Zendesk Help Center API and generates
a single markdown document organized by Category > Section > Article.
Re-run this script anytime KB articles are updated in Zendesk.
"""

import json
import urllib.request
import base64
import html
import re
import sys
import os
from datetime import datetime

# --- Configuration ---
SUBDOMAIN = "rockstarautomations"
EMAIL = "virender.verma@rockstar-automations.com"
TOKEN = os.environ.get("ZENDESK_TOKEN", "NOSblmOwZFc1hn1o0mf2NNg3xmyEc5UHjr8GS0TM")
BASE_URL = f"https://{SUBDOMAIN}.zendesk.com/api/v2/help_center/en-us"
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zendesk-kb-consolidated.md")

auth = base64.b64encode(f"{EMAIL}/token:{TOKEN}".encode()).decode()
headers = {"Authorization": f"Basic {auth}"}


def fetch(url):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def html_to_md(h):
    if not h:
        return ""
    h = re.sub(r'<img[^>]*alt="([^"]*)"[^>]*/?>', r'[\1]', h)
    h = re.sub(r'<img[^>]*/?>', '', h)
    for i in range(6, 0, -1):
        h = re.sub(rf'<h{i}[^>]*>(.*?)</h{i}>', lambda m, lvl=i: '#' * lvl + ' ' + m.group(1).strip(), h, flags=re.DOTALL)
    h = re.sub(r'<(strong|b)>(.*?)</\1>', r'**\2**', h, flags=re.DOTALL)
    h = re.sub(r'<(em|i)>(.*?)</\1>', r'*\2*', h, flags=re.DOTALL)
    h = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', r'[\2](\1)', h, flags=re.DOTALL)
    h = re.sub(r'<li[^>]*>(.*?)</li>', r'- \1', h, flags=re.DOTALL)
    h = re.sub(r'<br\s*/?>', '\n', h)
    h = re.sub(r'<p[^>]*>(.*?)</p>', r'\1\n\n', h, flags=re.DOTALL)
    h = re.sub(r'<div[^>]*>(.*?)</div>', r'\1\n', h, flags=re.DOTALL)
    h = re.sub(r'<[^>]+>', '', h)
    h = html.unescape(h)
    h = re.sub(r'\n{3,}', '\n\n', h)
    return h.strip()


def main():
    print("Fetching categories...")
    cats = {}
    data = fetch(f"{BASE_URL}/categories.json")
    for c in data["categories"]:
        cats[c["id"]] = c["name"]

    print("Fetching sections...")
    secs = {}
    page = 1
    while True:
        data = fetch(f"{BASE_URL}/sections.json?page={page}&per_page=100")
        for s in data["sections"]:
            secs[s["id"]] = {"name": s["name"], "cat_id": s["category_id"]}
        if not data["next_page"]:
            break
        page += 1

    print("Fetching articles...")
    articles = []
    page = 1
    while True:
        data = fetch(f"{BASE_URL}/articles.json?page={page}&per_page=100")
        for a in data["articles"]:
            articles.append({
                "id": a["id"],
                "title": a["title"],
                "body": a.get("body", "") or "",
                "section_id": a["section_id"],
                "draft": a["draft"],
                "updated_at": a["updated_at"],
                "html_url": a["html_url"],
            })
        if not data["next_page"]:
            break
        page += 1

    print(f"Fetched {len(articles)} articles")

    # Organize: category -> section -> articles
    structure = {}
    for cat_id, cat_name in cats.items():
        structure[cat_id] = {"name": cat_name, "sections": {}}

    for sec_id, sec_info in secs.items():
        cat_id = sec_info["cat_id"]
        if cat_id not in structure:
            structure[cat_id] = {"name": f"Unknown ({cat_id})", "sections": {}}
        structure[cat_id]["sections"][sec_id] = {"name": sec_info["name"], "articles": []}

    for a in articles:
        sec_id = a["section_id"]
        placed = False
        for cat_id, cat_data in structure.items():
            if sec_id in cat_data["sections"]:
                cat_data["sections"][sec_id]["articles"].append(a)
                placed = True
                break
        if not placed:
            cat_id = secs.get(sec_id, {}).get("cat_id", 0)
            if cat_id not in structure:
                structure[cat_id] = {"name": "Other", "sections": {}}
            if sec_id not in structure[cat_id]["sections"]:
                structure[cat_id]["sections"][sec_id] = {"name": secs.get(sec_id, {}).get("name", "Unknown"), "articles": []}
            structure[cat_id]["sections"][sec_id]["articles"].append(a)

    # Generate markdown
    lines = []
    lines.append("# Meow Mobile / Meow Wireless - Knowledge Base")
    lines.append("")
    lines.append(f"> **Source:** https://{SUBDOMAIN}.zendesk.com/hc/en-us")
    lines.append(f"> **Last synced:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"> **Total articles:** {len(articles)}")
    lines.append("> **Note:** This is a static snapshot. Changes in Zendesk KB will NOT auto-update here. Re-run `python3 scripts/sync-zendesk-kb.py` to refresh.")
    lines.append("")

    # Table of contents
    lines.append("## Table of Contents")
    lines.append("")
    toc_num = 0
    for cat_id, cat_data in structure.items():
        has_articles = any(cat_data["sections"][s]["articles"] for s in cat_data["sections"])
        if not has_articles:
            continue
        toc_num += 1
        anchor = re.sub(r'[^a-z0-9\s-]', '', cat_data["name"].lower()).strip().replace(' ', '-')
        lines.append(f"{toc_num}. [{cat_data['name']}](#{anchor})")
        for sec_id, sec_data in cat_data["sections"].items():
            if sec_data["articles"]:
                sec_anchor = re.sub(r'[^a-z0-9\s-]', '', sec_data["name"].lower()).strip().replace(' ', '-')
                lines.append(f"   - [{sec_data['name']}](#{sec_anchor}) ({len(sec_data['articles'])} articles)")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Content
    for cat_id, cat_data in structure.items():
        has_articles = any(cat_data["sections"][s]["articles"] for s in cat_data["sections"])
        if not has_articles:
            continue

        lines.append(f"## {cat_data['name']}")
        lines.append("")

        for sec_id, sec_data in cat_data["sections"].items():
            if not sec_data["articles"]:
                continue

            lines.append(f"### {sec_data['name']}")
            lines.append("")

            for a in sec_data["articles"]:
                draft_tag = " [DRAFT]" if a["draft"] else ""
                lines.append(f"#### {a['title']}{draft_tag}")
                lines.append(f"*Article ID: {a['id']} | Updated: {a['updated_at'][:10]}*")
                lines.append(f"*URL: {a['html_url']}*")
                lines.append("")

                body = html_to_md(a["body"])
                if body:
                    lines.append(body)
                else:
                    lines.append("*(No content)*")
                lines.append("")
                lines.append("---")
                lines.append("")

        lines.append("")

    output = "\n".join(lines)
    with open(OUTPUT_FILE, "w") as f:
        f.write(output)

    print(f"Written to {OUTPUT_FILE}")
    print(f"Total lines: {len(lines)}")


if __name__ == "__main__":
    main()
