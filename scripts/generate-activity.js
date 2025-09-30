const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const token = process.env.GH_TOKEN;
const reposEnv = process.env.GH_REPOS || '';
const limit = parseInt(process.env.GH_ACTIVITY_LIMIT || '20', 10);

if (!token) {
  console.error('❌ Missing GH_TOKEN (use GITHUB_TOKEN or PAT).');
  process.exit(1);
}
if (!reposEnv) {
  console.error('❌ Missing GH_REPOS (e.g., user/repo1,user/repo2).');
  process.exit(1);
}

const octokit = new Octokit({ auth: token });
const CACHE_DIR = path.join('.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'activity.json');
const OUT_MD = path.join(CACHE_DIR, 'RECENT_ACTIVITY.md');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function safe(fn, args) {
  try { return await fn(args); }
  catch { await sleep(2000); try { return await fn(args); } catch { return { data: [] }; } }
}

async function fetchRepoActivity(full) {
  const [owner, repo] = full.split('/');
  const prs = await safe(octokit.pulls.list, { owner, repo, state: 'all', per_page: 10 });
  const commits = await safe(octokit.repos.listCommits, { owner, repo, per_page: 10 });

  return {
    repo: full,
    prs: prs.data.map(p => ({
      number: p.number,
      state: p.state,
      title: p.title,
      merged_at: p.merged_at,
      updated_at: p.updated_at
    })),
    commits: commits.data.map(c => ({
      sha: c.sha,
      message: (c.commit?.message || '').split('\n')[0],
      date: c.commit?.author?.date || ''
    }))
  };
}

(async () => {
  const repos = reposEnv.split(',').map(s => s.trim()).filter(Boolean);
  const all = [];

  for (const r of repos) {
    all.push(await fetchRepoActivity(r));
    await sleep(500);
  }

  const lines = [];
  for (const a of all) {
    for (const p of a.prs) lines.push({ when: p.updated_at || p.merged_at, text: `PR #${p.number} ${(p.merged_at ? 'MERGED' : p.state.toUpperCase())} — ${p.title} (${a.repo})` });
    for (const c of a.commits) lines.push({ when: c.date, text: `Commit ${c.sha.substring(0,7)} — ${c.message} (${a.repo})` });
  }

  lines.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));

  const md = (lines.slice(0, limit).map(x => `- ${x.text}`)).join('\n') || '- No recent activity.';
  fs.writeFileSync(OUT_MD, md);
  fs.writeFileSync(CACHE_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: reposEnv,
    items: lines.slice(0, limit)
  }, null, 2));

  console.log('✅ Generated .cache/RECENT_ACTIVITY.md & .cache/activity.json');
})();
