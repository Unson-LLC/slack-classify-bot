#!/usr/bin/env node
/**
 * Update SalesTailor project to commit to SalesTailor-inc/Drive
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

async function updateProject() {
  console.log('📊 Updating SalesTailor project repository...\n');

  const projectRepository = new ProjectRepository();

  try {
    // Get current salestailor project
    const salestailorProject = await projectRepository.getProjectByName('salestailor');

    if (!salestailorProject) {
      console.error('❌ salestailor project not found');
      process.exit(1);
    }

    console.log('Current configuration:');
    console.log(`  Repository: ${salestailorProject.owner}/${salestailorProject.repo}`);
    console.log(`  Branch: ${salestailorProject.branch}`);
    console.log(`  Channels: ${salestailorProject.slack_channels.length}`);
    salestailorProject.slack_channels.forEach(ch => {
      const chName = typeof ch === 'string' ? ch : ch.channel_name;
      console.log(`    - ${chName}`);
    });

    // Update repository to SalesTailor-inc/Drive
    salestailorProject.owner = 'SalesTailor-inc';
    salestailorProject.repo = 'Drive';
    salestailorProject.branch = 'main';

    console.log('\nNew configuration:');
    console.log(`  Repository: ${salestailorProject.owner}/${salestailorProject.repo}`);
    console.log(`  Branch: ${salestailorProject.branch}`);

    // Save updated project
    await projectRepository.saveProject(salestailorProject);

    console.log('\n✅ SalesTailor project updated successfully');
    console.log('\nAll SalesTailor channels will now commit to:');
    console.log(`   ${salestailorProject.owner}/${salestailorProject.repo} (${salestailorProject.branch})`);

  } catch (error) {
    console.error('❌ Failed to update project:', error.message);
    process.exit(1);
  }
}

updateProject();
