#!/usr/bin/env node
/**
 * Update aitle project to use Tech-Knight-inc/tech-knight repository
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

async function updateProject() {
  console.log('📊 Updating aitle project repository...\n');

  const projectRepository = new ProjectRepository();

  try {
    // Get current aitle project
    const aitleProject = await projectRepository.getProjectByName('aitle');

    if (!aitleProject) {
      console.error('❌ aitle project not found');
      process.exit(1);
    }

    console.log('Current configuration:');
    console.log(`  Owner: ${aitleProject.owner}`);
    console.log(`  Repo: ${aitleProject.repo}`);
    console.log(`  Branch: ${aitleProject.branch}`);

    // Update repository to tech-knight
    aitleProject.owner = 'Tech-Knight-inc';
    aitleProject.repo = 'tech-knight';
    // Keep branch as develop

    console.log('\nNew configuration:');
    console.log(`  Owner: ${aitleProject.owner}`);
    console.log(`  Repo: ${aitleProject.repo}`);
    console.log(`  Branch: ${aitleProject.branch}`);

    // Save updated project
    await projectRepository.saveProject(aitleProject);

    console.log('\n✅ aitle project updated successfully');

  } catch (error) {
    console.error('❌ Failed to update project:', error.message);
    process.exit(1);
  }
}

updateProject();
