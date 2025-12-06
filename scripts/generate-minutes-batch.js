#!/usr/bin/env node
/**
 * Batch generate meeting minutes from transcripts
 * Usage: node scripts/generate-minutes-batch.js <transcripts-dir> <minutes-dir> [project-name]
 */

const fs = require('fs');
const path = require('path');
const { generateMeetingMinutes, summarizeText, formatMinutesForGitHub } = require('../api/llm-integration');

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node generate-minutes-batch.js <transcripts-dir> <minutes-dir> [project-name]');
    process.exit(1);
  }

  const transcriptsDir = args[0];
  const minutesDir = args[1];
  const projectName = args[2] || null;

  // Ensure directories exist
  if (!fs.existsSync(transcriptsDir)) {
    console.error(`Transcripts directory not found: ${transcriptsDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(minutesDir)) {
    fs.mkdirSync(minutesDir, { recursive: true });
  }

  // Get all transcript files
  const files = fs.readdirSync(transcriptsDir)
    .filter(f => f.endsWith('.txt'))
    .sort();

  console.log(`Found ${files.length} transcripts in ${transcriptsDir}`);

  // Check which already have minutes
  const existingMinutes = new Set(
    fs.readdirSync(minutesDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  );

  const toProcess = files.filter(f => {
    const baseName = f.replace('.txt', '');
    return !existingMinutes.has(baseName);
  });

  console.log(`${toProcess.length} transcripts need minutes`);

  for (let i = 0; i < toProcess.length; i++) {
    const file = toProcess[i];
    const baseName = file.replace('.txt', '');
    const transcriptPath = path.join(transcriptsDir, file);
    const minutesPath = path.join(minutesDir, `${baseName}.md`);

    console.log(`\n[${i + 1}/${toProcess.length}] Processing: ${file}`);

    try {
      // Read transcript
      const transcript = fs.readFileSync(transcriptPath, 'utf-8');

      if (!transcript.trim()) {
        console.log('  Skipping: empty transcript');
        continue;
      }

      // Extract date from filename (YYYY-MM-DD_topic.txt)
      const dateMatch = baseName.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

      // Generate summary
      console.log('  Generating summary...');
      const summary = await summarizeText(transcript);

      // Generate detailed minutes
      console.log('  Generating minutes...');
      const minutesData = await generateMeetingMinutes(transcript, projectName);

      if (!minutesData) {
        console.log('  Failed to generate minutes');
        continue;
      }

      // Format for file
      const formattedMinutes = formatMinutesForGitHub(minutesData);

      // Build markdown with frontmatter
      const markdown = `---
transcript_ref: ../transcripts/${file}
date: ${date}
project: unson-board
---

# ${date} ${baseName.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/-/g, ' ')}

## 要約

${summary || '要約生成に失敗しました'}

---

\`\`\`json
${JSON.stringify({
  minutes: minutesData.minutes || formattedMinutes,
  actions: minutesData.actions || []
}, null, 2)}
\`\`\`
`;

      // Write minutes file
      fs.writeFileSync(minutesPath, markdown, 'utf-8');
      console.log(`  Saved: ${minutesPath}`);

      // Rate limiting - wait between requests
      if (i < toProcess.length - 1) {
        console.log('  Waiting 2s before next...');
        await new Promise(r => setTimeout(r, 2000));
      }

    } catch (error) {
      console.error(`  Error processing ${file}:`, error.message);
    }
  }

  console.log('\nBatch processing complete!');
}

main().catch(console.error);
