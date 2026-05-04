// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// Global variables
let chatPanel: vscode.WebviewPanel | undefined;
let conversationHistory: { role: string; content: string; tokens:number }[] = [];
let modelName: string = '';
let contextSize: number = 4096; // Default, will be updated from server
let currentSourceLang: string = 'Chinese';
let currentTargetLang: string = 'English';
let extensionPath: string = '';
let totalSlots: number = 1; // Default number of slots
const port: number = 8080; // Default port

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	extensionPath = context.extensionPath;

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "visualnoveltranslator" is now active!');

	// Initialize server info
	initializeServerInfo();

	// Register commands
	const translateRpyDisposable = vscode.commands.registerCommand('visualnoveltranslator.translateRpy', translateRpyLine);
	const openChatDisposable = vscode.commands.registerCommand('visualnoveltranslator.openChat', openChatWindow);
	const sendToChatDisposable = vscode.commands.registerCommand('visualnoveltranslator.sendToChat', sendSelectedToChat);

	context.subscriptions.push(translateRpyDisposable, openChatDisposable, sendToChatDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// Initialize server info
async function initializeServerInfo() {
	try {
		// Get model info
		const modelResponse = await makeHttpRequest('GET', `http://localhost:${port}/v1/models`);
		const modelData = JSON.parse(modelResponse);
		modelName = modelData.models[0].model;

		// Get model properties
		const propsResponse = await makeHttpRequest('GET', `http://localhost:${port}/props`);
		const propsData = JSON.parse(propsResponse);
		contextSize = propsData.default_generation_settings.n_ctx;
		totalSlots = propsData.total_slots;
		
		// console.log(`Model: ${modelName}, Context Size: ${contextSize}, Total Slots: ${totalSlots}`);
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to initialize server info: ${error}`);
	}
}

// Helper function to make HTTP requests
function makeHttpRequest(method: string, url: string, data?: any): Promise<string> {
	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port,
			path: urlObj.pathname + urlObj.search,
			method: method,
			headers: {
				'Content-Type': 'application/json',
			}
		};

		const req = http.request(options, (res) => {
			let body = '';
			res.on('data', (chunk) => {
				body += chunk;
			});
			res.on('end', () => {
				resolve(body);
			});
		});

		req.on('error', (err) => {
			reject(err);
		});

		if (data) {
			req.write(JSON.stringify(data));
		}
		req.end();
	});
}

// Translate RPY line
async function translateRpyLine() {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !editor.document.fileName.endsWith('.rpy')) {
		vscode.window.showErrorMessage('This command is only available for .rpy files.');
		return;
	}

	const position = editor.selection.active;
	const line = position.line;
	if (line === 0) {
		vscode.window.showErrorMessage('No previous line to translate.');
		return;
	}

	const previousLine = editor.document.lineAt(line - 1).text;
	const match = previousLine.match(/"([^"]*)"/);
	if (!match) {
		vscode.window.showErrorMessage('No quoted text found in the previous line.');
		return;
	}

	let textToTranslate = match[1];
	// Filter out format tags
	textToTranslate = textToTranslate.replace(/\{[^}]*\}/g, '');

	try {
		const translation = await translateText(textToTranslate, currentSourceLang, currentTargetLang);
		const currentLine = editor.document.lineAt(line).text;
		const newLine = currentLine.replace(/""/, `"${translation}"`);
		editor.edit(editBuilder => {
			editBuilder.replace(new vscode.Range(line, 0, line, currentLine.length), newLine);
		});
	} catch (error) {
		vscode.window.showErrorMessage(`Translation failed: ${error}`);
	}
}

// Translate text using the server
async function translateText(text: string, sourceLang: string, targetLang: string): Promise<string> {
	let prompt = '';

	if (sourceLang === "Chinese" || targetLang === "Chinese") {
		prompt = `将以下文本翻译为 ${targetLang}，注意只需要输出翻译后的结果，不要额外解释：\n\n ${text}`;
	} else {
		prompt = `Translate the following segment into ${targetLang}, without additional explanation:\n\n ${text}`;
	}

	// console.log(`Translating from ${sourceLang} to ${targetLang}: ${text}`);
	// if (sourceLang === targetLang) {
	// 	return text; // No translation needed
	// }
	// const prompt = `Translate the following text from ${sourceLang} to ${targetLang}, without additional explanation:\n\n${text}`;

	// Calculate the tokens count of the user input
	const number_of_tokens = await countTokens(prompt);

	// Add to conversation history
	conversationHistory.push({ role: 'user', content: prompt, tokens: number_of_tokens});


	let totalTokens = number_of_tokens;
	for(let i = conversationHistory.length - 2; i >= 0; i -= 2)
	{
		totalTokens += conversationHistory[i].tokens + conversationHistory[i-1].tokens;
		if(totalTokens > contextSize * 0.8) // Keep 80% of context
		{
			conversationHistory = conversationHistory.slice(i+1);
			break;
		}
	}

	const data = {
		model: modelName,
		messages: conversationHistory,
		top_k: 20,
		top_p: 0.6,
		temperature: 0.7,
		repetition_penalty: 1.05
	};

	try {
		const response = await makeHttpRequest('POST', `http://localhost:${port}/v1/chat/completions`, data);
		const responseData = JSON.parse(response);
		const translation = responseData.choices[0].message.content;
		const completion_tokens = responseData.usage.completion_tokens;
		// const prompt_tokens = responseData.usage.prompt_tokens;

		// Update the user message tokens count with the actual token count from the server
		conversationHistory.push({ role: 'assistant', content: translation, tokens: completion_tokens });
		return translation;
	} catch (error) {
		throw new Error(`Translation request failed: ${error}`);
	}
}

async function countTokens(text: string): Promise<number> {
	const data = {model: modelName, messages: [{role: 'user', content: text}]};
	try {
		const response = await makeHttpRequest('POST', `http://localhost:${port}/v1/messages/count_tokens`, data);
		const responseData = JSON.parse(response);
		return responseData.input_tokens;
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to count tokens: ${error}`);
		return 0;
	}
}

async function eraseAllSlots(): Promise<void> {
	try {
		for(let i = 0; i < totalSlots; i++) { 
			await makeHttpRequest('POST', `http://localhost:${port}/slots/${i}?action=erase`);
		}
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to erase slots: ${error}`);
	}
}

// Tokenize text to estimate token count
async function tokenizeText(text: string): Promise<any[]> {
	const data = { content: text };
	try {
		const response = await makeHttpRequest('POST', `http://localhost:${port}/tokenize`, data);
		const responseData = JSON.parse(response);
		return responseData.tokens;
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to tokenize text: ${error}`);
		return [];
	}
}

// Open chat window
function openChatWindow() {
	if (chatPanel) {
		chatPanel.reveal(vscode.ViewColumn.Beside);
		return;
	}

	chatPanel = vscode.window.createWebviewPanel(
		'translationChat',
		'Translation Chat',
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			localResourceRoots: []
		}
	);

	chatPanel.webview.html = getChatHtml(currentSourceLang, currentTargetLang);

	chatPanel.onDidDispose(() => {
		chatPanel = undefined;
	}, null);

	// Handle messages from webview
	chatPanel.webview.onDidReceiveMessage(async (message) => {
		switch (message.command) {
			case 'translate':
				try {
					const translation = await translateText(message.text, message.sourceLang, message.targetLang);
					chatPanel?.webview.postMessage({ command: 'translationResult', text: translation });
				} catch (error) {
					chatPanel?.webview.postMessage({ command: 'error', text: `Translation failed: ${error}` });
				}
				break;
			case 'regenerate':
				try {
					// delete the last user and assistant pair.
					if(conversationHistory.length >= 2) {
						conversationHistory.pop(); // Remove assistant response
						conversationHistory.pop(); // Remove user message
					}

					const translation = await translateText(message.text, message.sourceLang, message.targetLang);
					chatPanel?.webview.postMessage({ command: 'regenerationResult', text: translation });
				} catch (error) {
					chatPanel?.webview.postMessage({ command: 'error', text: `Regeneration failed: ${error}` });
				}
				break;
			case 'updateLanguage':
				currentSourceLang = message.sourceLang;
				currentTargetLang = message.targetLang;
				break;
			case 'requestHistory':
				chatPanel?.webview.postMessage({ command: 'restoreHistory', history: conversationHistory });
				break;
			case 'clearHistory':
				await eraseAllSlots(); // Clear all slots on the server
				conversationHistory = [];
				break;
		}
	});
}

// Get HTML for chat window
function getChatHtml(sourceLang: string, targetLang: string): string {
	const htmlPath = path.join(extensionPath, 'ui', 'chat.html')
	let html = fs.readFileSync(htmlPath, 'utf8');
	html = html
		.replace(/{{selectedSourceChinese}}/g, sourceLang === 'Chinese' ? ' selected' : '')
		.replace(/{{selectedSourceEnglish}}/g, sourceLang === 'English' ? ' selected' : '')
		.replace(/{{selectedSourceJapanese}}/g, sourceLang === 'Japanese' ? ' selected' : '')
		.replace(/{{selectedSourceKorean}}/g, sourceLang === 'Korean' ? ' selected' : '')
		.replace(/{{selectedTargetEnglish}}/g, targetLang === 'English' ? ' selected' : '')
		.replace(/{{selectedTargetChinese}}/g, targetLang === 'Chinese' ? ' selected' : '')
		.replace(/{{selectedTargetJapanese}}/g, targetLang === 'Japanese' ? ' selected' : '')
		.replace(/{{selectedTargetKorean}}/g, targetLang === 'Korean' ? ' selected' : '')
		.replace(/{{selectedSourceTraditionalChinese}}/g, sourceLang === 'Traditional Chinese' ? ' selected' : '')
		.replace(/{{selectedTargetTraditionalChinese}}/g, targetLang === 'Traditional Chinese' ? ' selected' : '')
		.replace(/{{selectedSourceFrench}}/g, sourceLang === 'French' ? ' selected' : '')
		.replace(/{{selectedTargetFrench}}/g, targetLang === 'French' ? ' selected' : '')
		.replace(/{{selectedSourceThai}}/g, sourceLang === 'Thai' ? ' selected' : '')
		.replace(/{{selectedTargetThai}}/g, targetLang === 'Thai' ? ' selected' : '')
		.replace(/{{selectedSourceItalian}}/g, sourceLang === 'Italian' ? ' selected' : '')
		.replace(/{{selectedTargetItalian}}/g, targetLang === 'Italian' ? ' selected' : '')
		.replace(/{{selectedSourceGerman}}/g, sourceLang === 'German' ? ' selected' : '')
		.replace(/{{selectedTargetGerman}}/g, targetLang === 'German' ? ' selected' : '');
	return html;
}

// Send selected text to chat
function sendSelectedToChat() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	const selection = editor.selection;
	const text = editor.document.getText(selection);
	if (!text.trim()) {
		vscode.window.showWarningMessage('No text selected.');
		return;
	}

	if (!chatPanel) {
		openChatWindow();
	}

	// Wait a bit for the panel to open, then send the message directly
	setTimeout(async () => {
		try {
			const translation = await translateText(text, currentSourceLang, currentTargetLang);
			chatPanel?.webview.postMessage({ command: 'directTranslation', userText: text, translation: translation });
		} catch (error) {
			chatPanel?.webview.postMessage({ command: 'error', text: `Translation failed: ${error}` });
		}
	}, 500);
}
