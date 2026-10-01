/**
 * Commits one file through the GitHub contents API, so the job needs no git
 * checkout and the token stays in a header (never in a remote URL or log).
 */
export interface CommitOptions {
  token: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}

const AUTHOR = { name: 'LanboTW', email: '48960020+LanboTW@users.noreply.github.com' };

export async function commitFile(o: CommitOptions): Promise<string> {
  const url = `https://api.github.com/repos/${o.repo}/contents/${o.path}`;
  const headers = {
    Authorization: `Bearer ${o.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'webnba-roster-update',
  };
  const cur = await fetch(`${url}?ref=${o.branch}`, { headers });
  if (!cur.ok) throw new Error(`GitHub 讀取 ${o.path} 失敗：${cur.status}`);
  const { sha, content } = (await cur.json()) as { sha: string; content: string };
  if (Buffer.from(content, 'base64').toString('utf8') === o.content) return 'unchanged';
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: o.message,
      content: Buffer.from(o.content, 'utf8').toString('base64'),
      sha,
      branch: o.branch,
      author: AUTHOR,
      committer: AUTHOR,
    }),
  });
  if (!res.ok) throw new Error(`GitHub 寫入 ${o.path} 失敗：${res.status}`);
  const body = (await res.json()) as { commit: { sha: string } };
  return body.commit.sha;
}
