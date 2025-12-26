import { window, workspace, commands, ExtensionContext, StatusBarAlignment, StatusBarItem, extensions } from 'vscode';
import { exec } from 'child_process';
import { GitExtension, Repository } from './git';

export function activate(ctx: ExtensionContext) {
	const gitVersionController = new GitVersionController(ctx);
	ctx.subscriptions.push(gitVersionController);
}

export function deactivate() { }

export class GitVersionController {

	private readonly command = "extension.gitVersionView";
	private repo: Repository;
	private gitVersionView: GitVersionView;

	public GitPath: string;

	constructor(private context: ExtensionContext) {
		this.gitVersionView = new GitVersionView(this.command);
		this.ConnectToGit();
		if (this.repo) {
			this.gitVersionView.updateStatusBarWithPath(this.GitPath).then((infoText) => {
				//	window.showInformationMessage(infoText, )
			});
		}
	}

	public dispose() {
		//console.log("Dispose StatusBar");
		this.gitVersionView.dispose();
	}

	private ConnectToGit() {
		const gitExtension = extensions.getExtension<GitExtension>('vscode.git').exports;
		const git = gitExtension.getAPI(1);
		this.setRepo(git.repositories[0]);

		// Subscribe GitApi Events
		this.context.subscriptions.push(git.onDidOpenRepository((value: Repository) => {
			this.onOpenRepository(value);
		}, this));

		this.context.subscriptions.push(git.onDidCloseRepository(() => {
			this.onCloseRepository();
		}, this));

		this.context.subscriptions.push(workspace.onDidChangeConfiguration(() => {
			this.onDidChangeConfiguration();
		}, this));

		// Subscribe On Command
		this.context.subscriptions.push(commands.registerCommand(this.command, () => {
			this.onCommandExecuted();
		}, this));
	}

	private setRepo(newRepo: Repository) {
		this.repo = newRepo;
		if (this.repo) {
			this.GitPath = this.repo.rootUri.fsPath;
			this.context.subscriptions.push(this.repo.state.onDidChange(() => {
				this.onDidChangeRepository();
			}, this));
		}
	}

	private async onOpenRepository(newRepo: Repository) {
		// console.log("onOpenRepo");
		this.setRepo(newRepo);

		if (this.repo) {
			this.gitVersionView.updateStatusBarWithPath(this.GitPath).then((infoText) => {
				//		window.showInformationMessage(infoText);
			});
		} else {
			console.log("Repo null");
			this.gitVersionView.hideStatusBar();
		}
	}

	private async onCloseRepository() {
		// console.log("OnCloseRepo");
		this.repo = undefined;
		this.GitPath = undefined;
		this.gitVersionView.hideStatusBar();
	}

	private async onDidChangeRepository() {
		// console.log("OnChangedRepo");
		if (this.repo) {
			this.gitVersionView.updateStatusBar();
		} else {
			// console.log("Repo null");
			this.gitVersionView.hideStatusBar();
		}
	}

	private async onCommandExecuted() {
		// console.log("OnCommandExecuted");

		if (this.repo) {
			this.gitVersionView.updateStatusBarWithPath(this.GitPath).then((infoText) => {
				window.showInformationMessage(infoText);
			});
		} else {
			console.log("Repo null");
			window.showErrorMessage("No Git Repository found.");
			this.gitVersionView.hideStatusBar();
		}
	}

	private async onDidChangeConfiguration() {
		//console.log("OnChangedConfig");
		if (this.repo) {
			this.gitVersionView.updateStatusBarWithConfig();
		} else {
			this.gitVersionView.hideStatusBar();
		}
	}
}

class GitVersionView {

	private readonly ErrorPopupMessage = "GitVersion not found.";
	private readonly ErrorStatusBarMessage = `$(issue-opened) GitVersion`;

	private statusBarItem: StatusBarItem;
	private rootFolderPath: string;
	private command: string;
	private versionFormat: string;
	private statusBarItemText: string;
	private infoMessageText: string;

	//TODO: Complete GitVersion Variable List
	private versionFormatCheckList: Array<string> = ["SemVer", "FullSemVer", "MajorMinorPatch", "InformationalVersion"];
	private commandCheckList: Array<string> = ["gitversion", "dotnet-gitversion"];

	constructor(private clickActivation: string) {
		this.command = undefined;
		this.versionFormat = undefined;
		this.rootFolderPath = undefined;
		this.statusBarItemText = this.ErrorStatusBarMessage;
		this.infoMessageText = this.ErrorPopupMessage;
	}

	public async updateStatusBarWithPath(gitPath: string): Promise<string> {
		this.rootFolderPath = gitPath;
		await this.internUpdateStatusBar(false, true);
		return this.infoMessageText;
	}

	public async updateStatusBarWithConfig(): Promise<string> {
		await this.internUpdateStatusBar(true, false);
		return this.infoMessageText;
	}

	public async updateStatusBar(): Promise<string> {
		await this.internUpdateStatusBar(false, false);
		return this.infoMessageText;
	}

	public dispose() {
		if (this.statusBarItem) {
			this.statusBarItem.dispose();
		}
	}

	public hideStatusBar() {
		if (this.statusBarItem) {
			this.statusBarItem.hide();
		}
	}

	private async internUpdateStatusBar(configChanged: boolean, workSpaceChanged: boolean) {

		if (!this.statusBarItem) {
			this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
			this.statusBarItem.command = this.clickActivation;
		}

		if(configChanged || !this.command) {
			this.command = this.getCommandSetting();
			let commandValid = this.checkIfCommandIsValid();
			if (!commandValid) {
				this.reportAnError("Extension settings are not valid. Command " + this.command + " is not valid!");
				return;
			}
		}

		if (configChanged || !this.versionFormat) {
			this.versionFormat = this.getVersionFormatSetting();
			let versionFormatValid = this.checkIfVersionFormatIsValid();
			if (!versionFormatValid) {
				this.reportAnError("Extension settings are not valid. VersionFormat " + this.versionFormat + " is not valid!");
				return;
			}
		}

		if (!this.rootFolderPath) {
			this.reportAnError("No valid workspace folder available.");
			return;
		}

		await this.callGitVersion().then((response: promiseResponse) => {
			if (response.stderr) {
				this.reportAnError(response.stderr.message);
			}
			else {
				this.refreshStatusBar(response.stdout);
			}
		});
	}

	private reportAnError(message: string) {
		this.statusBarItemText = this.ErrorStatusBarMessage;
		this.infoMessageText = this.ErrorPopupMessage;
		window.showErrorMessage(message);
		this.statusBarItem.text = this.statusBarItemText;
		this.statusBarItem.show();
	}

	private refreshStatusBar(version: string) {
		this.statusBarItemText = `$(info) GitVersion:  ${version}`;
		this.infoMessageText = `GitVersion:  ${version}`;
		this.statusBarItem.text = this.statusBarItemText;
		this.statusBarItem.show();
	}

	private async callGitVersion(): Promise<promiseResponse> {
		
		var executeCommand = `${this.command} "${this.rootFolderPath}" -output json -showvariable ${this.versionFormat}`;

		let responseString = await asyncExec(executeCommand).then((stdout: string) => {
			console.log(stdout);
			return { stdout: stdout, stderr: undefined };
		}).catch((err: string) => {
			console.log(err);
			return { stdout: undefined, stderr: err };
		});
		return responseString;
	}

	private getVersionFormatSetting(): string {
		let configVersionFormat = workspace.getConfiguration("gitVersionView").get("versionFormat");
		return <string>configVersionFormat;
	}

	private checkIfVersionFormatIsValid(): boolean {

		if (!this.versionFormat) {
			return false;
		}

		let found = false;
		var currentVersionFormat = this.versionFormat.toLowerCase();
		this.versionFormatCheckList.forEach((entry) => {
			let currentEntry = entry.toLowerCase();
			if (currentVersionFormat === currentEntry) {
				found = true;
			}
		});

		return found;
	}

	private getCommandSetting(): string {
		let configCommand = workspace.getConfiguration("gitVersionView").get("command");
		return <string>configCommand;
	}

	private checkIfCommandIsValid(): boolean {

		if (!this.command) {
			return false;
		}

		let found = false;
		var currentCommand = this.command.toLowerCase();
		this.commandCheckList.forEach((entry) => {
			let currentEntry = entry.toLowerCase();
			if (currentCommand === currentEntry) {
				found = true;
			}
		});

		return found;
	}
}

type promiseResponse = { stdout, stderr };

async function asyncExec(command: string) {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				return reject(error);
			}
			if (stderr) {
				return reject(new Error(stderr));
			}
			resolve(stdout);
		});
	});
}



