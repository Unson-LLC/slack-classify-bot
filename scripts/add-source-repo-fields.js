#!/usr/bin/env node
/**
 * Add source_owner, source_repo, source_branch fields to existing projects
 *
 * Usage:
 *   node scripts/add-source-repo-fields.js --dry-run    # Preview changes
 *   node scripts/add-source-repo-fields.js              # Apply changes
 */

const path = require('path');
const ProjectRepository = require(path.join(__dirname, '../api/project-repository'));

// Default source repo mappings
// Update these based on actual repository locations
const SOURCE_REPO_MAPPINGS = {
  'proj_mana': {
    source_owner: 'ksato',
    source_repo: 'mana',
    source_branch: 'main'
  },
  'proj_salestailor': {
    source_owner: 'SalesTailor-inc',
    source_repo: 'salestailor',
    source_branch: 'main'
  },
  'proj_tech-knight': {
    source_owner: 'tech-knight-inc',
    source_repo: 'tech-knight',
    source_branch: 'main'
  },
  'proj_zeims': {
    source_owner: 'ksato',
    source_repo: 'zeims',
    source_branch: 'main'
  },
  'proj_baao': {
    source_owner: 'ksato',
    source_repo: 'baao',
    source_branch: 'main'
  }
  // Add more mappings as needed
};

async function addSourceRepoFields() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== Add Source Repo Fields to Projects ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'APPLY CHANGES'}`);
  console.log('');

  const projectRepository = new ProjectRepository();

  try {
    const projects = await projectRepository.getAllProjects();
    console.log(`Found ${projects.length} projects\n`);

    for (const project of projects) {
      const projectId = project.project_id;
      const mapping = SOURCE_REPO_MAPPINGS[projectId];

      console.log(`📁 ${project.name} (${projectId})`);

      // Check if already has source fields
      if (project.source_owner && project.source_repo) {
        console.log(`   ✓ Already configured: ${project.source_owner}/${project.source_repo}@${project.source_branch}`);
        continue;
      }

      if (!mapping) {
        console.log(`   ⚠ No mapping defined - skipping`);
        console.log(`   Add mapping to SOURCE_REPO_MAPPINGS in this script`);
        continue;
      }

      console.log(`   → Adding: ${mapping.source_owner}/${mapping.source_repo}@${mapping.source_branch}`);

      if (!dryRun) {
        const updatedProject = {
          ...project,
          source_owner: mapping.source_owner,
          source_repo: mapping.source_repo,
          source_branch: mapping.source_branch
        };
        await projectRepository.saveProject(updatedProject);
        console.log(`   ✓ Updated`);
      } else {
        console.log(`   (dry-run: would update)`);
      }
    }

    console.log('\n=== Done ===');

    if (dryRun) {
      console.log('\nRun without --dry-run to apply changes:');
      console.log('  node scripts/add-source-repo-fields.js');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

addSourceRepoFields();
