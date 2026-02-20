/**
 * KB Search — In-memory article index from zendesk-kb-consolidated.md
 *
 * On first call, reads the KB markdown and parses into an article index.
 * Exports searchKB(query, category) — keyword match, returns top 5.
 */

const fs = require('fs');
const path = require('path');

const KB_FILE = path.join(__dirname, '../../zendesk-kb-consolidated.md');

let articles = null; // lazy-loaded

/**
 * Parse the consolidated KB markdown into an article index.
 * Each article has: { id, title, category, body, url }
 */
function loadArticles() {
  if (articles) return articles;

  const raw = fs.readFileSync(KB_FILE, 'utf-8');
  articles = [];

  let currentCategory = '';
  let currentSubCategory = '';
  let currentArticle = null;

  const lines = raw.split('\n');
  for (const line of lines) {
    // Top-level section: ## Category
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      flushArticle(currentArticle);
      currentArticle = null;
      currentCategory = h2Match[1].trim();
      continue;
    }

    // Sub-category: ### SubCategory
    const h3Match = line.match(/^### (.+)/);
    if (h3Match) {
      flushArticle(currentArticle);
      currentArticle = null;
      currentSubCategory = h3Match[1].trim();
      continue;
    }

    // Article title: #### Title
    const h4Match = line.match(/^#### (.+)/);
    if (h4Match) {
      flushArticle(currentArticle);
      currentArticle = {
        id: null,
        title: h4Match[1].trim(),
        category: currentSubCategory || currentCategory,
        parentCategory: currentCategory,
        body: '',
        url: null,
      };
      continue;
    }

    // Article metadata lines (inside an article)
    if (currentArticle) {
      const idMatch = line.match(/Article ID:\s*(\d+)/);
      if (idMatch) {
        currentArticle.id = idMatch[1];
        continue;
      }
      const urlMatch = line.match(/\*URL:\s*(https?:\/\/[^\s*]+)/);
      if (urlMatch) {
        currentArticle.url = urlMatch[1];
        continue;
      }
      // Skip metadata lines
      if (line.match(/^\*Article ID:|^\*Updated:/)) continue;

      // Accumulate body text
      currentArticle.body += line + '\n';
    }
  }
  flushArticle(currentArticle);

  console.log(`[KB] Loaded ${articles.length} articles from zendesk-kb-consolidated.md`);
  return articles;

  function flushArticle(article) {
    if (!article || !article.title) return;
    article.body = article.body.trim();
    // Build search text once
    article._searchText = (article.title + ' ' + article.body + ' ' + article.category).toLowerCase();
    articles.push(article);
  }
}

/**
 * Map category aliases to canonical KB categories for filtering.
 */
const CATEGORY_ALIASES = {
  esim: ['esim', 'e-sim', 'sim'],
  portin: ['port-in', 'port-out', 'porting', 'port'],
  payment: ['payment', 'refund', 'billing', 'charge'],
  network: ['network', 'connectivity', 'signal', 'troubleshooting'],
  airvet: ['airvet', 'vet', 'pet'],
  account: ['account', 'login', 'password', 'profile'],
};

/**
 * Search the KB for articles matching a query.
 *
 * @param {string} query — search keywords
 * @param {string} [category] — optional category filter (e.g. "esim", "portin")
 * @param {number} [limit=5] — max results
 * @returns {Array<{id, title, url, snippet, category}>}
 */
function searchKB(query, category, limit = 5) {
  const index = loadArticles();
  if (!query) return [];

  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

  // Category filter: expand aliases
  let categoryKeywords = null;
  if (category) {
    const cat = category.toLowerCase();
    categoryKeywords = CATEGORY_ALIASES[cat] || [cat];
  }

  const scored = [];
  for (const article of index) {
    // Category filter
    if (categoryKeywords) {
      const artCat = (article.category + ' ' + article.parentCategory).toLowerCase();
      if (!categoryKeywords.some(ck => artCat.includes(ck))) continue;
    }

    // Score: count keyword hits in title (weighted 3x) + body (1x)
    let score = 0;
    const titleLower = article.title.toLowerCase();
    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 3;
      if (article._searchText.includes(kw)) score += 1;
    }

    if (score > 0) {
      // Extract snippet: first ~150 chars of body
      const snippet = article.body.substring(0, 150).replace(/\n/g, ' ').trim() +
        (article.body.length > 150 ? '...' : '');
      scored.push({ ...article, score, snippet, _searchText: undefined });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ score, ...rest }) => rest);
}

/**
 * Force reload the article index (e.g. after KB sync).
 */
function reloadKB() {
  articles = null;
  loadArticles();
}

module.exports = { searchKB, reloadKB };
