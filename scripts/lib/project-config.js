const yaml = require('js-yaml');

const DEFAULT_BRANCH = 'main';

function normalizeProjectId(id) {
  if (!id) return '';
  return id.startsWith('proj_') ? id : `proj_${id}`;
}

function deriveName(id) {
  if (!id) return '';
  const base = id.replace(/^proj_/, '').replace(/[-_]+/g, ' ');
  return base
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseConfigYaml(ymlContent) {
  const data = yaml.load(ymlContent) || {};
  return {
    root: data.root || '',
    projects: data.projects || []
  };
}

function parseChannelsYaml(ymlContent) {
  const data = yaml.load(ymlContent) || {};
  return data.channels || [];
}

function groupChannelsByProject(channels) {
  const grouped = new Map();
  for (const ch of channels) {
    const pid = normalizeProjectId(ch.project_id || ch.projectId || '');
    if (!pid) continue;
    if (!grouped.has(pid)) {
      grouped.set(pid, { channels: [], crosspost: [] });
    }
    const entry = {
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      workspace: ch.workspace,
      type: ch.type || 'general'
    };
    if (ch.is_crosspost_target) {
      grouped.get(pid).crosspost.push(entry);
    } else {
      grouped.get(pid).channels.push(entry);
    }
  }
  return grouped;
}

/**
 * 統合レコードを生成（config.yml + channels.yml）
 * 戻り値: { records, warnings }
 */
function buildProjectRecords(configObj, channelsList) {
  const grouped = groupChannelsByProject(channelsList);
  const records = [];
  const warnings = [];

  for (const p of configObj.projects) {
    const pid = normalizeProjectId(p.id);
    const name = p.name || deriveName(pid);
    const slack = grouped.get(pid) || { channels: [], crosspost: [] };

    const rec = {
      project_id: pid,
      name,
      is_active: true,
      // GitHub config (airtable-integration.js expects these field names)
      owner: p.github?.owner,
      repo: p.github?.repo,
      branch: p.github?.branch || (p.github ? DEFAULT_BRANCH : undefined),
      path_prefix: p.github?.path_prefix || (p.github ? 'meetings/' : undefined),
      // Legacy field names for backwards compatibility
      github_owner: p.github?.owner,
      github_repo: p.github?.repo,
      github_branch: p.github?.branch || (p.github ? DEFAULT_BRANCH : undefined),
      // Other config
      airtable_base_id: p.airtable?.base_id,
      airtable_base_name: p.airtable?.base_name,
      local_path: p.local?.path,
      glob_include: p.local?.glob_include,
      slack_channels: slack.channels,
      crosspost_channels: slack.crosspost,
      updated_at: Math.floor(Date.now() / 1000)
    };
    records.push(rec);
  }

  // channels.yml にあるが config.yml に無いプロジェクトを検知
  for (const pid of grouped.keys()) {
    if (!records.find(r => r.project_id === pid)) {
      // プロジェクト一覧に出さず警告のみ出したい場合はここでcontinueもできる
      warnings.push(`channels.yml に存在するが config.yml に無い project_id: ${pid}`);
      records.push({
        project_id: pid,
        name: deriveName(pid),
        is_active: false,
        slack_channels: grouped.get(pid).channels,
        crosspost_channels: grouped.get(pid).crosspost,
        missing_in_config: true,
        updated_at: Math.floor(Date.now() / 1000)
      });
    }
  }

  return { records, warnings };
}

module.exports = {
  normalizeProjectId,
  deriveName,
  parseConfigYaml,
  parseChannelsYaml,
  buildProjectRecords
};
