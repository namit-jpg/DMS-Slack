const fs = require('fs');
const path = require('path');
const readline = require('readline');

const src = path.join(__dirname, '..', '.env.live.example');
const dst = path.join(__dirname, '..', '.env');

async function main() {
  console.log('=== DMSFA Live Environment Setup ===');
  console.log('');

  if (fs.existsSync(dst)) {
    console.log('.env already exists at: ' + dst);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question('Overwrite? (y/N): ', resolve));
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Skipped. Your .env was not modified.');
      return;
    }
  }

  fs.copyFileSync(src, dst);
  console.log(`Created .env from .env.live.example at ${dst}`);
  console.log('');
  console.log('=== Next Steps ===');
  console.log('1. Verify Salesforce CLI auth:  npm run sf:cli-auth-check');
  console.log('2. Check Slack CLI:             npm run live:check');
  console.log('3. Run capability audit:        npm run live:capability-audit');
  console.log('4. Run smoke test:             npm run live:smoke');
  console.log('5. Start live dev:             npm run live:dev');
  console.log('');
  console.log('Make sure .env has valid SLACK_BOT_TOKEN and SLACK_APP_TOKEN before starting.');
}

main().catch(console.error);
