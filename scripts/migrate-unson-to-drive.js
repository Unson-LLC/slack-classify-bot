#!/usr/bin/env node
/**
 * Migrate all Unson-LLC projects to Unson-LLC/Drive repository
 * with meetings/project-name/ path structure
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

async function migrateProjects() {
  console.log('📊 Migrating all Unson-LLC projects to Unson-LLC/Drive...\n');

  const projectRepository = new ProjectRepository();

  try {
    // Get all projects
    const allProjects = await projectRepository.getAllProjects();

    // Filter Unson-LLC projects
    const unsonProjects = allProjects.filter(p => p.owner === 'Unson-LLC');

    console.log(`Found ${unsonProjects.length} Unson-LLC projects to migrate\n`);

    let updatedCount = 0;

    for (const project of unsonProjects) {
      console.log(`\n--- Processing: ${project.name} ---`);
      console.log(`  Current: ${project.owner}/${project.repo}`);
      console.log(`  Current path_prefix: ${project.path_prefix}`);
      console.log(`  Current branch: ${project.branch}`);

      // Update to Unson-LLC/Drive
      project.owner = 'Unson-LLC';
      project.repo = 'Drive';
      project.branch = 'main';

      // Ensure path_prefix follows meetings/project-name/ pattern
      const expectedPrefix = `meetings/${project.name}/`;
      if (project.path_prefix !== expectedPrefix) {
        console.log(`  Updating path_prefix: ${project.path_prefix} → ${expectedPrefix}`);
        project.path_prefix = expectedPrefix;
      }

      console.log(`  New: ${project.owner}/${project.repo} (${project.branch})`);
      console.log(`  New path_prefix: ${project.path_prefix}`);

      // Save updated project
      await projectRepository.saveProject(project);
      updatedCount++;

      console.log(`  ✅ Updated`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Migration completed successfully`);
    console.log(`   Updated ${updatedCount} projects`);
    console.log(`\n   All Unson-LLC projects now commit to:`);
    console.log(`   Unson-LLC/Drive (main)`);
    console.log(`   with path structure: meetings/プロジェクト名/\n`);

  } catch (error) {
    console.error('❌ Failed to migrate projects:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migrateProjects();
