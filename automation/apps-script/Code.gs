/**
 * Kafedra IS schedule board — Drive → GitHub sync.
 *
 * Pulls the latest .xlsx schedule files from Google Drive (public "anyone with
 * the link" folders/files, possibly owned by different accounts) and commits
 * them into the GitHub repo under raw/<stable-name>.xlsx. A GitHub Actions
 * workflow (.github/workflows/rebuild.yml) watches raw/**.xlsx and rebuilds
 * the board automatically whenever this script pushes a change.
 *
 * SETUP
 * 1. script.google.com -> New project -> paste this whole file over Code.gs.
 * 2. Project Settings (gear icon) -> Script Properties -> add:
 *      GITHUB_TOKEN   a GitHub PAT with 'repo' scope (classic) or
 *                     Contents: Read & write (fine-grained), scoped to this repo
 *      GITHUB_REPO    e.g. "drashidinov/ATUscheduleIS"
 *      GITHUB_BRANCH  e.g. "main"                 (optional, defaults to "main")
 *      SOURCES        the JSON array below (edit the folder/file IDs as needed)
 * 3. Run `syncSchedules` once manually (Run menu) and authorize it.
 * 4. Triggers (clock icon, left sidebar) -> Add trigger -> syncSchedules ->
 *    Time-driven -> Hours timer -> every 6 hours (or whatever cadence fits).
 *
 * SOURCES script property — a JSON array, one entry per file to track:
 *   [
 *     {"folderId": "1eA-lcoSPEpt61yUIBHxT5nWnEG-IHins", "target": "raw/1_kurs.xlsx"},
 *     {"folderId": "1EeNW0zytgQ4589orfxgZY3oHPOJ1jZkG", "target": "raw/2_kurs.xlsx"},
 *     {"folderId": "1VqbRrpsIzX0thsfz3V41qC8qBeLNNnLb", "target": "raw/3_kurs.xlsx"},
 *     {"folderId": "1YW_mXxgdIWg3p8Z7APQpfED2H-hTGwKj", "target": "raw/4_kurs.xlsx"},
 *     {"folderId": "<magistracy profile folder id>",     "target": "raw/magistratura_profil.xlsx"},
 *     {"folderId": "<magistracy nauch-ped folder id>",   "target": "raw/magistratura_nauchped.xlsx"},
 *     {"folderId": "<magistracy 2 kurs folder id>",      "target": "raw/magistratura_2kurs.xlsx"},
 *     {"folderId": "<doktorantura folder id>",           "target": "raw/doktorantura_1kurs.xlsx"}
 *   ]
 * Each entry can use "fileId" instead of "folderId" if the source is a direct
 * link to one file rather than a folder (the newest .xlsx in a folder is
 * picked automatically, so a folder is preferred whenever the file gets
 * re-uploaded under a new name each week).
 */

function syncSchedules() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("GITHUB_TOKEN");
  const repo = props.getProperty("GITHUB_REPO");
  const branch = props.getProperty("GITHUB_BRANCH") || "main";
  const sources = JSON.parse(props.getProperty("SOURCES") || "[]");

  if (!token || !repo || sources.length === 0) {
    Logger.log("Missing GITHUB_TOKEN / GITHUB_REPO / SOURCES script properties — nothing to do.");
    return;
  }

  const stateKey = "LAST_SEEN";
  const lastSeen = JSON.parse(props.getProperty(stateKey) || "{}");
  const newSeen = Object.assign({}, lastSeen);

  const treeEntries = [];
  const changedTargets = [];

  sources.forEach(function (src) {
    try {
      const file = pickSourceFile(src);
      if (!file) {
        Logger.log("No file found for source: " + JSON.stringify(src));
        return;
      }
      const signature = file.getId() + "|" + file.getLastUpdated().getTime();
      if (lastSeen[src.target] === signature) {
        return; // unchanged since last run
      }
      const base64 = Utilities.base64Encode(file.getBlob().getBytes());
      const blobSha = ghCreateBlob(repo, token, base64);
      treeEntries.push({ path: src.target, mode: "100644", type: "blob", sha: blobSha });
      changedTargets.push(src.target);
      newSeen[src.target] = signature;
    } catch (e) {
      Logger.log("Error processing " + JSON.stringify(src) + ": " + e);
    }
  });

  if (treeEntries.length === 0) {
    Logger.log("Nothing changed.");
    return;
  }

  const tip = ghGetBranchTip(repo, token, branch);
  const newTreeSha = ghCreateTree(repo, token, tip.treeSha, treeEntries);
  const message = "Update schedule source(s): " + changedTargets.join(", ");
  const newCommitSha = ghCreateCommit(repo, token, message, newTreeSha, tip.commitSha);
  ghUpdateRef(repo, token, branch, newCommitSha);

  props.setProperty(stateKey, JSON.stringify(newSeen));
  Logger.log("Committed: " + changedTargets.join(", "));
}

/** Returns the newest .xlsx File in a folder, or a specific file by id. */
function pickSourceFile(src) {
  if (src.fileId) {
    return DriveApp.getFileById(src.fileId);
  }
  const folder = DriveApp.getFolderById(src.folderId);
  const it = folder.getFiles();
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!/\.xlsx$/i.test(f.getName())) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

function ghHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
  };
}

function ghGetBranchTip(repo, token, branch) {
  const refUrl = "https://api.github.com/repos/" + repo + "/git/ref/heads/" + branch;
  const refResp = UrlFetchApp.fetch(refUrl, { headers: ghHeaders(token), muteHttpExceptions: true });
  const ref = JSON.parse(refResp.getContentText());
  const commitSha = ref.object.sha;

  const commitUrl = "https://api.github.com/repos/" + repo + "/git/commits/" + commitSha;
  const commitResp = UrlFetchApp.fetch(commitUrl, { headers: ghHeaders(token), muteHttpExceptions: true });
  const commit = JSON.parse(commitResp.getContentText());
  return { commitSha: commitSha, treeSha: commit.tree.sha };
}

function ghCreateBlob(repo, token, base64Content) {
  const url = "https://api.github.com/repos/" + repo + "/git/blobs";
  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: ghHeaders(token),
    payload: JSON.stringify({ content: base64Content, encoding: "base64" }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(resp.getContentText());
  if (!body.sha) throw new Error("blob create failed: " + resp.getContentText());
  return body.sha;
}

function ghCreateTree(repo, token, baseTreeSha, entries) {
  const url = "https://api.github.com/repos/" + repo + "/git/trees";
  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: ghHeaders(token),
    payload: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(resp.getContentText());
  if (!body.sha) throw new Error("tree create failed: " + resp.getContentText());
  return body.sha;
}

function ghCreateCommit(repo, token, message, treeSha, parentSha) {
  const url = "https://api.github.com/repos/" + repo + "/git/commits";
  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: ghHeaders(token),
    payload: JSON.stringify({ message: message, tree: treeSha, parents: [parentSha] }),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(resp.getContentText());
  if (!body.sha) throw new Error("commit create failed: " + resp.getContentText());
  return body.sha;
}

function ghUpdateRef(repo, token, branch, commitSha) {
  const url = "https://api.github.com/repos/" + repo + "/git/refs/heads/" + branch;
  const resp = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: ghHeaders(token),
    payload: JSON.stringify({ sha: commitSha }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) throw new Error("ref update failed: " + resp.getContentText());
}
