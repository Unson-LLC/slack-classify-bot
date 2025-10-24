#!/usr/bin/env node
/**
 * Update aitle project branch to main
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

async function updateProject() {
  console.log('📊 Updating aitle project branch to main...\n');

  const projectRepository = new ProjectRepository();

  try {
    // Get current aitle project
    const aitleProject = await projectRepository.getProjectByName('aitle');

    if (!aitleProject) {
      console.error('❌ aitle project not found');
      process.exit(1);
    }

    console.log('Current configuration:');
    console.log(`  Repository: ${aitleProject.owner}/${aitleProject.repo}`);
    console.log(`  Branch: ${aitleProject.branch}`);

    // Update branch to main
    aitleProject.branch = 'main';

    console.log('\nNew configuration:');
    console.log(`  Repository: ${aitleProject.owner}/${aitleProject.repo}`);
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
