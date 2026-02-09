/**
 * Skill Loader for CS Intelligence Platform
 *
 * Loads all skill markdown files and prepares them for injection
 * into Claude's system prompt.
 *
 * Usage:
 *   const { loadAllSkills, getSkillByName } = require('./lib/skill-loader');
 *   const skills = loadAllSkills();
 *   const systemPrompt = BASE_PROMPT + '\n\n' + skills;
 */

const fs = require('fs');
const path = require('path');

// Default skills directory - can be overridden
const DEFAULT_SKILLS_DIR = path.join(__dirname, '../../.claude/skills');

/**
 * Load a single skill file by name
 * @param {string} skillName - Name of the skill (without .md extension)
 * @param {string} skillsDir - Directory containing skill files
 * @returns {string|null} - Skill content or null if not found
 */
function getSkillByName(skillName, skillsDir = DEFAULT_SKILLS_DIR) {
  const filePath = path.join(skillsDir, `${skillName}.md`);

  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    console.warn(`Skill not found: ${skillName}`);
    return null;
  } catch (error) {
    console.error(`Error loading skill ${skillName}:`, error.message);
    return null;
  }
}

/**
 * Load all skill files from the skills directory
 * @param {string} skillsDir - Directory containing skill files
 * @returns {string} - Combined skill content formatted for system prompt
 */
function loadAllSkills(skillsDir = DEFAULT_SKILLS_DIR) {
  const skills = [];

  try {
    if (!fs.existsSync(skillsDir)) {
      console.warn(`Skills directory not found: ${skillsDir}`);
      return '';
    }

    const files = fs.readdirSync(skillsDir)
      .filter(file => file.endsWith('.md'))
      .sort(); // Alphabetical order for consistency

    for (const file of files) {
      const filePath = path.join(skillsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const skillName = file.replace('.md', '');

      skills.push({
        name: skillName,
        content: content
      });
    }

    // Format skills for system prompt
    return formatSkillsForPrompt(skills);

  } catch (error) {
    console.error('Error loading skills:', error.message);
    return '';
  }
}

/**
 * Format loaded skills into a system prompt section
 * @param {Array} skills - Array of {name, content} objects
 * @returns {string} - Formatted skills section
 */
function formatSkillsForPrompt(skills) {
  if (skills.length === 0) {
    return '';
  }

  let output = `
## CS Knowledge Base & Skills

You have access to the following skills and knowledge. Use them to help agents resolve customer issues consistently and effectively.

### Available Skills:
${skills.map(s => `- **${s.name}**: ${getSkillDescription(s.content)}`).join('\n')}

---

`;

  // Add each skill's full content
  for (const skill of skills) {
    output += `
<skill name="${skill.name}">
${skill.content}
</skill>

---

`;
  }

  return output;
}

/**
 * Extract the first line description from a skill's content
 * @param {string} content - Full skill markdown content
 * @returns {string} - Brief description
 */
function getSkillDescription(content) {
  // Look for description after the title
  const lines = content.split('\n');
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    // Skip title, empty lines, and headers
    if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('|')) {
      return line.substring(0, 100) + (line.length > 100 ? '...' : '');
    }
  }
  return 'No description';
}

/**
 * Load specific skills by name (for lighter context when needed)
 * @param {Array<string>} skillNames - Array of skill names to load
 * @param {string} skillsDir - Directory containing skill files
 * @returns {string} - Combined skill content
 */
function loadSelectedSkills(skillNames, skillsDir = DEFAULT_SKILLS_DIR) {
  const skills = [];

  for (const name of skillNames) {
    const content = getSkillByName(name, skillsDir);
    if (content) {
      skills.push({ name, content });
    }
  }

  return formatSkillsForPrompt(skills);
}

/**
 * Get list of available skill names
 * @param {string} skillsDir - Directory containing skill files
 * @returns {Array<string>} - Array of skill names
 */
function listAvailableSkills(skillsDir = DEFAULT_SKILLS_DIR) {
  try {
    if (!fs.existsSync(skillsDir)) {
      return [];
    }

    return fs.readdirSync(skillsDir)
      .filter(file => file.endsWith('.md'))
      .map(file => file.replace('.md', ''))
      .sort();
  } catch (error) {
    console.error('Error listing skills:', error.message);
    return [];
  }
}

/**
 * Determine which skills are most relevant based on issue keywords
 * @param {string} issueText - Ticket subject or description
 * @returns {Array<string>} - Recommended skill names
 */
function detectRelevantSkills(issueText) {
  const text = issueText.toLowerCase();
  const relevant = new Set(['cs-agent-guide']); // Always include master guide

  // Keyword to skill mapping
  const skillKeywords = {
    'esim-troubleshooting': ['esim', 'e-sim', 'activation', 'qr code', 'can\'t activate', 'no service', 'sim'],
    'portin-troubleshooting': ['port', 'transfer number', 'keep my number', 'old carrier', 'porting'],
    'payment-issues': ['payment', 'charge', 'refund', 'billing', 'card', 'declined', 'invoice'],
    'network-connectivity': ['signal', 'network', 'data', 'call', 'text', 'sms', 'no service', 'slow'],
    'account-management': ['login', 'password', 'account', 'email', 'delete', 'cancel', 'suspend'],
    'airvet-support': ['airvet', 'vet', 'pet', 'veterinary', 'animal'],
    'escalation-guide': ['escalate', 'manager', 'supervisor', 'complaint'],
    'email-handling': ['email', 'reply', 'response'],
    'mochi-handoff': ['mochi', 'bot', 'chatbot', 'transferred'],
    'reactive-communication': ['consolidate', 'merge tickets', 'multiple tickets', 'duplicate ticket', 'suppress auto-ack', 'same customer']
  };

  for (const [skill, keywords] of Object.entries(skillKeywords)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        relevant.add(skill);
        break;
      }
    }
  }

  return Array.from(relevant);
}

module.exports = {
  loadAllSkills,
  loadSelectedSkills,
  getSkillByName,
  listAvailableSkills,
  detectRelevantSkills,
  DEFAULT_SKILLS_DIR
};
