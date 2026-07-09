#!/usr/bin/env node
import { execSync } from 'child_process';

console.log('🔍 Verifying typecheck...');
try {
  execSync('pnpm typecheck', { stdio: 'inherit' });
  console.log('✅ Typecheck passed');
} catch (e) {
  console.error('❌ Typecheck failed');
  process.exit(1);
}

console.log('\n🔍 Verifying lint...');
try {
  execSync('pnpm lint', { stdio: 'inherit' });
  console.log('✅ Lint passed');
} catch (e) {
  console.error('❌ Lint failed');
  process.exit(1);
}

console.log('\n🔍 Running tests...');
try {
  execSync('pnpm test:unit', { stdio: 'inherit' });
  console.log('✅ Tests passed');
} catch (e) {
  console.error('❌ Tests failed');
  process.exit(1);
}

console.log('\n🔍 Building...');
try {
  execSync('pnpm build', { stdio: 'inherit' });
  console.log('✅ Build passed');
} catch (e) {
  console.error('❌ Build failed');
  process.exit(1);
}

console.log('\n✨ All checks passed! Gate is green.');
