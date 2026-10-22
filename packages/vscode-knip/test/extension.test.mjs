import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as vscode from 'vscode';

const waitFor = async (predicate, consecutiveMatches = 1) => {
  let matches = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    matches = predicate() ? matches + 1 : 0;
    if (matches === consecutiveMatches) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Timed out waiting for extension state');
};

export async function extensionActivates() {
  const ext = vscode.extensions.getExtension('webpro.vscode-knip');
  assert.ok(ext, 'Extension should be present');
  await ext.activate();
  assert.ok(ext.isActive, 'Extension should be active');
}

export async function knipRestartCommandExists() {
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('knip.restart'), 'knip.restart command should exist');
}

export async function knipRestartReloadsLocalVersion() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'Fixture workspace should be open');
  const fileUri = vscode.Uri.joinPath(folder.uri, 'index.js');
  const packageJsonPath = vscode.Uri.joinPath(folder.uri, 'node_modules/knip/package.json').fsPath;
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const initialVersion = `knip-version-${pkg.version}`;
  const updatedVersion = 'knip-version-2.0.0';
  const getKnipDiagnosticMessages = () =>
    vscode.languages
      .getDiagnostics(fileUri)
      .filter(diagnostic => diagnostic.source === 'knip')
      .map(diagnostic => diagnostic.message);

  await waitFor(() => getKnipDiagnosticMessages().some(message => message.includes(initialVersion)));

  writeFileSync(packageJsonPath, JSON.stringify({ ...pkg, version: '2.0.0' }));

  await vscode.commands.executeCommand('knip.restart');
  await waitFor(() => {
    const messages = getKnipDiagnosticMessages();
    return (
      messages.some(message => message.includes(updatedVersion)) &&
      !messages.some(message => message.includes(initialVersion))
    );
  }, 10);
}

export async function knipConfigurationChangeRestartsServer() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const fileUri = vscode.Uri.joinPath(folder.uri, 'index.js');
  await waitFor(() => vscode.languages.getDiagnostics(fileUri).some(diagnostic => diagnostic.source === 'knip'));
  const localPackage = vscode.Uri.joinPath(folder.uri, 'node_modules/knip/package.json').fsPath;
  const pkg = JSON.parse(readFileSync(localPackage, 'utf8'));
  writeFileSync(localPackage, JSON.stringify({ ...pkg, version: '1.1.0' }));
  const manifest = vscode.Uri.joinPath(folder.uri, 'package.json').fsPath;
  const content = JSON.parse(readFileSync(manifest, 'utf8'));
  writeFileSync(manifest, JSON.stringify({ ...content, description: 'trigger configuration reload' }));
  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(fileUri)
        .some(diagnostic => diagnostic.source === 'knip' && diagnostic.message.includes('knip-version-1.1.0')),
    10
  );
}
