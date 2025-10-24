#!/usr/bin/env node
/**
 * Add tech-knight-board project to DynamoDB
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

async function addProject() {
  console.log('📊 Adding tech-knight-board project to DynamoDB...\n');

  const projectRepository = new ProjectRepository();

  const project = {
    project_id: 'proj_tech-knight-board',
    name: 'tech-knight-board',
    owner: 'Tech-Knight-inc',
    repo: 'tech-knight',
    path_prefix: 'meetings/',
    branch: 'main',
    emoji: '📋',
    description: 'Tech Knight Board meeting minutes',
    slack_channels: [
      {
        channel_id: 'C09GXUG5UG4',
        channel_name: '0072-tech-knight-board'
      }
    ],
    is_active: true
  };

  try {
    const savedProject = await projectRepository.saveProject(project);
    console.log('✅ Project created successfully:', savedProject.name);
    console.log('   ID:', savedProject.project_id);
    console.log('   Repo:', `${savedProject.owner}/${savedProject.repo}`);
    console.log('   Channel:', savedProject.slack_channels[0].channel_name);
  } catch (error) {
    console.error('❌ Failed to create project:', error.message);
    process.exit(1);
  }
}

addProject();
