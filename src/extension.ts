import * as vscode from 'vscode';
import { WebViewManager } from './ui/webview';
import { ConfigManager } from './utils/config';
import { t, initializeI18n } from './i18n';
import { CueModeError } from './types';

/**
 * Main extension class
 */
export class CueModeExtension {
  private webViewManager: WebViewManager;
  private configChangeListener: vscode.Disposable | undefined;

  constructor(private context: vscode.ExtensionContext) {
    this.webViewManager = new WebViewManager(context);
  }

  /**
   * Activate the extension
   */
  public async activate(): Promise<void> {
    console.log('CueMode extension is now active!');

    try {
      // Initialize i18n system first
      await initializeI18n();
      
      // Register commands
      this.registerCommands();

      // Setup configuration listener
      this.setupConfigurationListener();

      // Register for cleanup
      this.context.subscriptions.push(
        { dispose: () => this.deactivate() }
      );
    } catch (error) {
      console.error('Failed to activate CueMode extension:', error);
      vscode.window.showErrorMessage(t('errors.initializationFailed', { error: String(error) }));
    }
  }

  /**
   * Deactivate the extension
   */
  public deactivate(): void {
    console.log('CueMode extension is deactivating...');
    
    // Close webview if active
    if (this.webViewManager.isActive()) {
      this.webViewManager.close();
    }

    // Cleanup listeners
    if (this.configChangeListener) {
      this.configChangeListener.dispose();
    }
  }

  /**
   * Register extension commands
   */
  private registerCommands(): void {
    // Main CueMode command
    const cueModeCommand = vscode.commands.registerCommand('cuemode.cueMode', () => {
      this.activateCueMode();
    });

    // Change theme command
    const changeThemeCommand = vscode.commands.registerCommand('cuemode.changeTheme', () => {
      this.changeTheme();
    });

    // Remove leading spaces command
    const removeLeadingSpacesCommand = vscode.commands.registerCommand('cuemode.removeLeadingSpaces', () => {
      this.removeLeadingSpaces();
    });

    // Cycle theme command
    const cycleThemeCommand = vscode.commands.registerCommand('cuemode.cycleTheme', () => {
      this.cycleTheme();
    });

    // Toggle focus mode command
    const toggleFocusModeCommand = vscode.commands.registerCommand('cuemode.toggleFocusMode', () => {
      this.toggleFocusMode();
    });

    this.context.subscriptions.push(cueModeCommand, changeThemeCommand, removeLeadingSpacesCommand, cycleThemeCommand, toggleFocusModeCommand);
  }

  /**
   * Setup configuration change listener
   */
  private setupConfigurationListener(): void {
    this.configChangeListener = ConfigManager.onConfigChanged(newConfig => {
      if (this.webViewManager.isActive()) {
        this.webViewManager.updateConfig(newConfig);
        
        // Show short auto-dismiss notification
        vscode.window.setStatusBarMessage(
          t('notifications.configUpdated'), 
          3000 // Auto-dismiss after 3 seconds
        );
      }
    });

    this.context.subscriptions.push(this.configChangeListener);
  }

  /**
   * Activate CueMode
   */
  private async activateCueMode(): Promise<void> {
    try {
      // Get active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        throw new CueModeError(t('errors.noActiveEditor'));
      }

      // Get content
      const document = editor.document;
      const selection = editor.selection;
      
      let content: string;
      if (!selection.isEmpty) {
        content = document.getText(selection);
      } else {
        content = document.getText();
      }

      if (!content.trim()) {
        throw new CueModeError(t('errors.noContent'));
      }

      // Get filename
      const filename = this.getFilename(document);

      // Get configuration
      const config = ConfigManager.getSafeConfig();

      // Create webview
      await this.webViewManager.create(content, filename, config);

      // Show short auto-dismiss notification
      vscode.window.setStatusBarMessage(
        t('notifications.activated'), 
        2000 // Auto-dismiss after 2 seconds
      );

    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get filename from document
   */
  private getFilename(document: vscode.TextDocument): string {
    if (document.isUntitled) {
      return `Untitled-${document.languageId}`;
    }

    const path = document.uri.fsPath;
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || 'Unknown';
  }

  /**
   * Change theme
   */
  private async changeTheme(): Promise<void> {
    try {
      const themes = ['classic', 'inverted', 'midnightBlue', 'sunset', 'forest', 'ocean', 'rose'];
      const themeLabels = themes.map(theme => {
        return {
          label: t(`themes.${theme}`),
          value: theme
        };
      });

      const selected = await vscode.window.showQuickPick(themeLabels, {
        placeHolder: t('commands.changeTheme')
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration('cuemode');
        await config.update('colorTheme', selected.value, vscode.ConfigurationTarget.Global);
        
        vscode.window.setStatusBarMessage(
          t('notifications.themeChanged', { theme: selected.label }),
          3000 // Auto-dismiss after 3 seconds
        );
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Cycle to next theme (for T key shortcut)
   */
  private async cycleTheme(): Promise<void> {
    try {
      const themes = ['classic', 'inverted', 'midnightBlue', 'sunset', 'forest', 'ocean', 'rose'];
      const config = vscode.workspace.getConfiguration('cuemode');
      const currentTheme = config.get<string>('colorTheme', 'classic');
      
      const currentIndex = themes.indexOf(currentTheme);
      const nextIndex = (currentIndex + 1) % themes.length;
      const nextTheme = themes[nextIndex];

      // Update configuration
      await config.update('colorTheme', nextTheme, vscode.ConfigurationTarget.Global);

      // Get localized theme name
      const themeName = t(`themes.${nextTheme}`);

      // Show VS Code notification
      vscode.window.setStatusBarMessage(
        t('notifications.themeChanged', { theme: themeName }),
        3000 // Auto-dismiss after 3 seconds
      );

      // Update webview if active
      if (this.webViewManager.isActive()) {
        const newConfig = ConfigManager.getSafeConfig();
        await this.webViewManager.updateConfig(newConfig);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Remove leading spaces from selected text
   */
  private async removeLeadingSpaces(): Promise<void> {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        throw new CueModeError(t('errors.noActiveEditor'));
      }

      const selection = editor.selection;
      const document = editor.document;
      
      // If no selection, use entire document
      const range = selection.isEmpty 
        ? new vscode.Range(0, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
        : selection;

      const text = document.getText(range);
      const lines = text.split('\n');
      let processedLines = 0;

      const processedText = lines.map(line => {
        // Remove leading spaces, tabs, and Chinese full-width spaces (U+3000)
        const trimmedLine = line.replace(/^[\s\t\u3000]+/, '');
        if (trimmedLine !== line) {
          processedLines++;
        }
        return trimmedLine;
      }).join('\n');

      if (processedLines > 0) {
        await editor.edit(editBuilder => {
          editBuilder.replace(range, processedText);
        });

        vscode.window.setStatusBarMessage(
          t('notifications.spacesRemoved', { count: processedLines }),
          3000 // Auto-dismiss after 3 seconds
        );
      } else {
        vscode.window.setStatusBarMessage(
          t('notifications.spacesRemoved', { count: 0 }),
          2000 // Auto-dismiss after 2 seconds
        );
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Toggle focus mode
   */
  private async toggleFocusMode(): Promise<void> {
    try {
      const currentConfig = ConfigManager.getConfig();
      const newFocusMode = !currentConfig.focusMode;
      
      // Update configuration
      await ConfigManager.updateConfig('focusMode', newFocusMode);
      
      // Show notification
      const message = newFocusMode 
        ? t('notifications.focusModeEnabled')
        : t('notifications.focusModeDisabled');
      
      vscode.window.setStatusBarMessage(message, 2000);
      
      // Update webview if active
      if (this.webViewManager.isActive()) {
        const updatedConfig = ConfigManager.getConfig();
        await this.webViewManager.updateConfig(updatedConfig);
      }
      
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: unknown): void {
    console.error('CueMode error:', error);

    let message: string;
    if (error instanceof CueModeError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = t('notifications.error', { message: error.message });
    } else {
      message = t('notifications.error', { message: String(error) });
    }

    vscode.window.showErrorMessage(message);
  }
}

/**
 * Extension activation function
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extension = new CueModeExtension(context);
  await extension.activate();
}

/**
 * Extension deactivation function
 */
export function deactivate(): void {
  // Cleanup handled by extension class
}
