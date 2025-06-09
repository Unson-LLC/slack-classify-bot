// n8n Code ノード用のスクリプト
// このコードをn8nの"Code"ノードにコピペしてください

const project = $input.first().json.project;
const file = $input.first().json.file;

// GitHubのパスを構築
const filePath = project.path_prefix + file.formattedName;
const branch = project.branch || 'main';

// レスポンスオブジェクトを作成
const response = {
  status: "success",
  message: "File processed and committed to GitHub",
  data: {
    owner: project.owner,
    repo: project.repo,
    filePath: filePath,
    commitMessage: `Add meeting transcript: ${file.name}`,
    commitUrl: `https://github.com/${project.owner}/${project.repo}/blob/${branch}/${filePath}`
  }
};

return response;