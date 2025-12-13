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

// Source repo mappings (GitHub owner/repo/branch)
// Based on config.yml mappings from brainbase
const SOURCE_REPO_MAPPINGS = {
  // --- Unson-LLC repos ---
  'proj_salestailor': {
    source_owner: 'Unson-LLC',
    source_repo: 'salestailor',
    source_branch: 'main'
  },
  'proj_zeims': {
    source_owner: 'Unson-LLC',
    source_repo: 'zeims-project',
    source_branch: 'main'
  },
  'proj_baao': {
    source_owner: 'Unson-LLC',
    source_repo: 'baao-project',
    source_branch: 'main'
  },
  'proj_unson': {
    source_owner: 'Unson-LLC',
    source_repo: 'Drive',
    source_branch: 'main'
  },
  'proj_ncom': {
    source_owner: 'Unson-LLC',
    source_repo: 'ncom-catalyst',
    source_branch: 'main'
  },
  'proj_senrigan': {
    source_owner: 'Unson-LLC',
    source_repo: 'senrigan-project',
    source_branch: 'main'
  },
  'proj_dialogai': {
    source_owner: 'Unson-LLC',
    source_repo: 'dialog_ai',
    source_branch: 'main'
  },
  'proj_mywa': {
    source_owner: 'Unson-LLC',
    source_repo: 'MyWa',
    source_branch: 'main'
  },
  'proj_unson-os': {
    source_owner: 'Unson-LLC',
    source_repo: 'unson_os',
    source_branch: 'main'
  },
  'proj_back-office': {
    source_owner: 'Unson-LLC',
    source_repo: 'back_office',
    source_branch: 'main'
  },

  // --- Tech-Knight-inc repos ---
  'proj_tech-knight': {
    source_owner: 'Tech-Knight-inc',
    source_repo: 'tech-knight-project',
    source_branch: 'main'
  },
  'proj_tech-knight-board': {
    source_owner: 'Tech-Knight-inc',
    source_repo: 'tech-knight-project',
    source_branch: 'main'
  },
  'proj_aitle': {
    source_owner: 'Tech-Knight-inc',
    source_repo: 'Aitle',
    source_branch: 'main'
  },
  'proj_eve-topi': {
    source_owner: 'Tech-Knight-inc',
    source_repo: 'eve-topi',
    source_branch: 'main'
  },
  'proj_hp_sales': {
    source_owner: 'Tech-Knight-inc',
    source_repo: 'hotel-hp-template',
    source_branch: 'main'
  },
  'proj_smartfront': {
    source_owner: 'Tech-Knight-inc',
    source_repo: 'smartfront',
    source_branch: 'main'
  },

  // --- Personal repos ---
  'proj_sato-portfolio': {
    source_owner: 'sintariran',
    source_repo: 'sato-portfolio',
    source_branch: 'main'
  },
  'proj_brainbase': {
    source_owner: 'sintariran',
    source_repo: 'brainbase',
    source_branch: 'main'
  },
  'proj_mana': {
    source_owner: 'sintariran',
    source_repo: 'mana',
    source_branch: 'main'
  }
  // Note: proj_ai-wolf, proj_emporio, proj_notionconnect, proj_postio, proj_toranomon are archived or local-only
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
