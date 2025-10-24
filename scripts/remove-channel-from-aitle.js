#!/usr/bin/env node
/**
 * Remove 0072-tech-knight-board channel from aitle project
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

async function updateProject() {
  console.log('📊 Updating aitle project in DynamoDB...\n');

  const projectRepository = new ProjectRepository();

  try {
    // Get current aitle project
    const aitleProject = await projectRepository.getProjectByName('aitle');

    if (!aitleProject) {
      console.error('❌ aitle project not found');
      process.exit(1);
    }

    console.log('Current channels:', aitleProject.slack_channels.length);
    aitleProject.slack_channels.forEach(ch => {
      console.log(`  - ${ch.channel_name} (${ch.channel_id})`);
    });

    // Remove 0072-tech-knight-board channel
    aitleProject.slack_channels = aitleProject.slack_channels.filter(
      ch => ch.channel_id !== 'C09GXUG5UG4'
    );

    console.log('\nNew channels:', aitleProject.slack_channels.length);
    aitleProject.slack_channels.forEach(ch => {
      console.log(`  - ${ch.channel_name} (${ch.channel_id})`);
    });

    // Save updated project
    await projectRepository.saveProject(aitleProject);

    console.log('\n✅ aitle project updated successfully');

  } catch (error) {
    console.error('❌ Failed to update project:', error.message);
    process.exit(1);
  }
}

updateProject();
