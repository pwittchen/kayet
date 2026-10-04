// Generates the "<app> alternative" landing pages into alternatives/ (run by `bun run build` / `dev`).
// Keep claims about other apps general and verifiable; prices and features change.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SITE = "https://getkayet.app";
const DMG = "https://github.com/pwittchen/kayet/releases/latest/download/kayet-macos-aarch64.dmg";

type Alt = {
  slug: string;
  name: string;
  kind: string; // "writing app" | "note-taking app" | "text editor"
  lead: string; // why someone would switch, in one or two sentences
  them: Record<Row, string>;
  rows?: [string, string, string][]; // extra comparison rows: [feature, kayet, them]
  familiar: [string, string][]; // [title, text]
  different: [string, string][];
  better: string[]; // when the other app is the better choice
  faq: [string, string][];
};

type Row = "price" | "source" | "storage" | "platforms";

const KAYET: Record<Row, string> = {
  price: "Free, no paid tiers",
  source: "Open source (Apache 2.0)",
  storage: "Plain files in any folder you pick",
  platforms: "macOS on Apple Silicon",
};

const ROW_LABELS: Record<Row, string> = {
  price: "Price",
  source: "Source code",
  storage: "Where your text lives",
  platforms: "Platforms",
};

const ALTS: Alt[] = [
  {
    slug: "ia-writer",
    name: "iA Writer",
    kind: "writing app",
    lead: "iA Writer made the case that a writing app should get out of the way. kayet takes the same idea, keeps your words in plain Markdown files, and costs nothing.",
    them: {
      price: "Paid",
      source: "Closed source",
      storage: "Plain text / Markdown files",
      platforms: "Mac, iPhone, iPad, Windows, Android",
    },
    rows: [
      ["Focus mode", "Zen mode: centered line, dimmed paragraphs", "Focus mode for sentence or paragraph"],
      ["Markdown preview", "Live split pane with scroll sync", "Preview pane and templates"],
      ["Export", "HTML and PDF", "HTML, PDF, Word and more"],
      ["Code files", "Syntax highlighting by file extension", "Aimed at prose"],
    ],
    familiar: [
      ["Nothing but text", "No toolbar, no sidebar, no status bar. The title bar and controls appear only when the cursor reaches the top of the window."],
      ["Focus on the paragraph", "Zen mode keeps the current line centered and dims everything except the paragraph you are writing."],
      ["Plain Markdown files", "Documents are ordinary <code>.md</code> files on your disk. Open them with anything, sync them with anything."],
    ],
    different: [
      ["Free and open source", "No license to buy for each device. The source code is on GitHub under the Apache License 2.0."],
      ["Also a text editor", "Code and config files are highlighted by extension, so the same quiet window works for a README, a script or a TOML file."],
      ["Slides from Markdown", "Split a document with <code>---</code> lines and present it full window, without leaving the editor."],
      ["Configured in a text file", "Every setting lives in <code>~/.kayet/config.toml</code>. No preferences window."],
    ],
    better: [
      "You write on iPhone, iPad, Windows or Android as well as on the Mac. kayet is a Mac app only.",
      "You rely on iA Writer's style check, syntax highlighting of parts of speech or authorship tracking.",
      "You need export to Word or publishing to a blog straight from the editor.",
    ],
    faq: [
      ["Is kayet a free alternative to iA Writer?", "Yes. kayet is free and open source under the Apache License 2.0, with no paid tiers, no feature gating and no telemetry."],
      ["Can kayet open my iA Writer documents?", "Yes. iA Writer keeps documents as plain text and Markdown files, and kayet edits those files directly. Point kayet's workspace at the folder that holds them."],
      ["Does kayet have a focus mode like iA Writer?", "kayet has zen mode (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>J</kbd>): the current line stays vertically centered and every paragraph except the one you are writing is dimmed."],
      ["Does kayet run on iPhone or Windows?", "No. kayet is built for macOS on Apple Silicon only."],
    ],
  },
  {
    slug: "typora",
    name: "Typora",
    kind: "Markdown editor",
    lead: "Typora renders Markdown in place as you type. kayet keeps the Markdown source visible, puts a live preview one shortcut away and stays out of your way the rest of the time.",
    them: {
      price: "Paid license after a free trial",
      source: "Closed source",
      storage: "Plain Markdown files",
      platforms: "Mac, Windows, Linux",
    },
    rows: [
      ["Editing style", "Markdown source with a live split preview", "Inline rendering (WYSIWYG-style)"],
      ["Built with", "Rust and Tauri, the system web view", "Electron"],
      ["Export", "HTML and PDF", "Many formats, through Pandoc"],
      ["Presentations", "Slides from <code>---</code> sections", "—"],
    ],
    familiar: [
      ["Markdown first", "CommonMark with GitHub tables, task lists, strikethrough and footnotes, rendered with clean typography."],
      ["A folder of files", "An optional file tree shows a folder of notes. Everything is a regular file on disk."],
      ["Images just work", "Pasted images are saved next to the document, and web images are shown from a downloaded copy."],
    ],
    different: [
      ["Source stays visible", "You always see and edit the Markdown itself. Toggle the preview with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd> when you want to see the result."],
      ["Small and native", "Rust and the macOS web view instead of a bundled browser engine. kayet starts instantly and stays tiny on disk."],
      ["Free and open source", "No license key, no trial period. Apache License 2.0."],
      ["Workspace search", "Jump to any file with <kbd>⌘</kbd><kbd>P</kbd> and search the text of the whole workspace with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>."],
    ],
    better: [
      "You prefer to edit rendered text and never see Markdown syntax.",
      "You need math, diagrams or export to formats like Word and EPUB.",
      "You work on Windows or Linux.",
    ],
    faq: [
      ["Is kayet a free Typora alternative?", "Yes. kayet is free and open source, with a live Markdown preview, HTML and PDF export and no license to buy."],
      ["Does kayet render Markdown inline like Typora?", "No. kayet shows the Markdown source and renders it in a live preview pane beside the editor, with scroll sync."],
      ["Is kayet built on Electron?", "No. kayet is written in Rust with Tauri and uses the web view built into macOS, so it does not ship its own browser engine."],
    ],
  },
  {
    slug: "ulysses",
    name: "Ulysses",
    kind: "writing app",
    lead: "Ulysses is a polished writing environment with its own library and a subscription. kayet is a free, quiet editor for plain Markdown files that you keep wherever you like.",
    them: {
      price: "Subscription",
      source: "Closed source",
      storage: "Its own library (external folders supported)",
      platforms: "Mac, iPhone, iPad",
    },
    rows: [
      ["Organization", "Folders and files in a workspace tree", "Groups, sheets, filters and keywords"],
      ["Export", "HTML and PDF", "PDF, Word, ePub, HTML and blog publishing"],
      ["Writing goals", "—", "Word and character goals"],
    ],
    familiar: [
      ["Distraction-free writing", "A clean page with no toolbars. Controls show up only when you reach for them."],
      ["Markdown underneath", "Headings, emphasis, lists and links are plain Markdown, with <kbd>⌘</kbd><kbd>B</kbd> and <kbd>⌘</kbd><kbd>I</kbd> to toggle emphasis."],
      ["Typewriter feel", "Zen mode keeps the current line in the middle of the window and dims the rest."],
    ],
    different: [
      ["No subscription", "kayet is free. There is nothing to renew and no account."],
      ["No library to export from", "Your documents are ordinary files in a folder. Git, Dropbox, iCloud Drive and every other tool can read them."],
      ["Open source", "Read the code, file an issue or build it yourself. Apache License 2.0."],
      ["Code-friendly", "Syntax highlighting for source and config files when you need to edit something other than prose."],
    ],
    better: [
      "You write on iPhone and iPad and want your library synced between them.",
      "You publish directly to WordPress, Ghost or Medium, or need ePub and Word export.",
      "You organize long projects with goals, filters and keywords.",
    ],
    faq: [
      ["Is there a free alternative to Ulysses for Mac?", "kayet is a free, open-source writing app for Mac with a distraction-free window, zen mode, a live Markdown preview and HTML / PDF export."],
      ["Can I move from Ulysses to kayet?", "Export your sheets from Ulysses as Markdown files (or use an external folder) and open that folder as kayet's workspace."],
      ["Does kayet sync between devices?", "kayet has no sync service of its own. Put your workspace in a folder synced by iCloud Drive, Dropbox or Git."],
    ],
  },
  {
    slug: "bear",
    name: "Bear",
    kind: "note-taking app",
    lead: "Bear is a lovely notes app that keeps notes in its own database. kayet keeps every note as a plain Markdown file in a folder you choose, free and with nothing to subscribe to.",
    them: {
      price: "Free, Pro subscription for sync",
      source: "Closed source",
      storage: "Its own database",
      platforms: "Mac, iPhone, iPad",
    },
    rows: [
      ["Organization", "Folders and files", "Tags and nested tags"],
      ["Linking notes", "Regular Markdown links", "Note links"],
      ["Export", "HTML and PDF", "Many formats"],
    ],
    familiar: [
      ["Clean and calm", "A quiet window, careful typography and eight built-in color themes that follow your light or dark appearance."],
      ["Markdown that keeps up", "Lists continue on Enter, pasted URLs over text become links and pasted images are saved next to the note."],
      ["Find anything", "Jump to a note with <kbd>⌘</kbd><kbd>P</kbd> or search all of them with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>."],
    ],
    different: [
      ["Notes are files", "Each note is a <code>.md</code> file in your workspace folder. No import, no export, no lock-in."],
      ["Free, no Pro tier", "Every feature is included. There is no subscription."],
      ["Edit anything", "Code and config files open with syntax highlighting, so kayet doubles as a light text editor."],
      ["Open source", "Apache License 2.0, developed in the open on GitHub."],
    ],
    better: [
      "You want built-in sync between Mac, iPhone and iPad.",
      "You organize notes with tags rather than folders.",
      "You need note-to-note links and backlinks.",
    ],
    faq: [
      ["Is kayet a free Bear alternative?", "kayet is a free, open-source Markdown notes editor for Mac. Unlike Bear, it stores each note as a plain file in a folder."],
      ["How do I move my notes from Bear to kayet?", "Export your notes from Bear as Markdown files into a folder, then open that folder in kayet as the workspace (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>O</kbd>)."],
      ["Does kayet have an iPhone app?", "No. kayet is a Mac app. Keep your notes in iCloud Drive or Dropbox to read them on other devices."],
    ],
  },
  {
    slug: "obsidian",
    name: "Obsidian",
    kind: "note-taking app",
    lead: "Obsidian is a powerful knowledge base built on Markdown files. If you mostly want to write, kayet gives you the same plain files in a far quieter, smaller window.",
    them: {
      price: "Free, paid Sync and Publish",
      source: "Closed source",
      storage: "Plain Markdown files in a vault",
      platforms: "Mac, Windows, Linux, iPhone, iPad, Android",
    },
    rows: [
      ["Built with", "Rust and Tauri, the system web view", "Electron"],
      ["Plugins", "None, by design", "Large community plugin ecosystem"],
      ["Linking notes", "Regular Markdown links", "Wikilinks, backlinks and graph view"],
      ["Presentations", "Slides from <code>---</code> sections", "Slides (core plugin)"],
    ],
    familiar: [
      ["A folder of Markdown", "Like a vault, kayet's workspace is just a folder. Open the same folder in both apps if you like."],
      ["Keyboard first", "A command palette on <kbd>⌘</kbd><kbd>K</kbd>, a file finder on <kbd>⌘</kbd><kbd>P</kbd> and workspace search on <kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>."],
      ["Themes", "Light and dark appearance with built-in themes like Nord, gruvbox and Solarized, or your own in a TOML file."],
    ],
    different: [
      ["Quiet by default", "No ribbon, no sidebars, no status bar. The file tree and preview are hidden until you ask for them."],
      ["Open source", "The whole app is open source under the Apache License 2.0."],
      ["Small and fast", "A native Rust app using the macOS web view. It starts instantly and takes little space."],
      ["Nothing to configure", "No plugins to choose and maintain. One TOML file holds every setting."],
    ],
    better: [
      "You build a personal knowledge base with backlinks, graph view and canvases.",
      "You depend on community plugins such as Dataview or Tasks.",
      "You need apps on Windows, Linux or mobile, or a hosted sync and publishing service.",
    ],
    faq: [
      ["Can kayet open an Obsidian vault?", "Yes. A vault is a folder of Markdown files, so you can open it as kayet's workspace with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>O</kbd> or <code>kayet path/to/vault</code>."],
      ["Does kayet support wikilinks and backlinks?", "No. kayet focuses on writing and editing. Links are regular Markdown links."],
      ["Is kayet open source?", "Yes, kayet is open source under the Apache License 2.0 and free to use, including commercially."],
    ],
  },
  {
    slug: "notion",
    name: "Notion",
    kind: "note-taking app",
    lead: "Notion is an online workspace for teams. For your own notes and writing, kayet is offline, private and fast: plain files on your Mac, no account and no cloud.",
    them: {
      price: "Free plan, paid plans",
      source: "Closed source",
      storage: "Notion's cloud",
      platforms: "Web, Mac, Windows, iPhone, iPad, Android",
    },
    rows: [
      ["Account required", "No", "Yes"],
      ["Works offline", "Always", "Limited"],
      ["Collaboration", "—", "Real-time, with comments and sharing"],
      ["Databases", "—", "Tables, boards, calendars"],
    ],
    familiar: [
      ["Pages that look good", "Markdown with headings, tables, task lists and images, rendered in a clean live preview."],
      ["Slash-free speed", "Every command is in the <kbd>⌘</kbd><kbd>K</kbd> palette, with fuzzy search."],
      ["Share as a page", "Export a document to a self-contained HTML page or a PDF with the preview's typography."],
    ],
    different: [
      ["Your notes stay on your Mac", "No account, no telemetry, no analytics. Nothing you type is sent anywhere."],
      ["Instant", "kayet starts immediately and never waits for a network."],
      ["Plain text forever", "Markdown files open in any editor, today and in twenty years."],
      ["Free and open source", "No plans, no seats, no limits. Apache License 2.0."],
    ],
    better: [
      "You collaborate with a team on shared pages in real time.",
      "You need databases, boards, calendars or project tracking.",
      "You work from a browser or on Windows and mobile devices.",
    ],
    faq: [
      ["Is kayet an offline alternative to Notion?", "For personal notes and writing, yes. kayet works entirely offline and stores notes as Markdown files on your Mac."],
      ["Can I import my Notion pages into kayet?", "Export your Notion workspace as Markdown, unzip it into a folder and open the folder as kayet's workspace."],
      ["Does kayet collect any data?", "No. The app has no accounts, telemetry, analytics or crash reporting. See the <a href=\"/privacy.html\">privacy policy</a>."],
    ],
  },
  {
    slug: "apple-notes",
    name: "Apple Notes",
    kind: "note-taking app",
    lead: "Apple Notes is always there, but your notes live inside it. kayet gives you the same calm, but every note is a Markdown file you own, with a live preview and real search across a folder.",
    them: {
      price: "Free, built into macOS",
      source: "Closed source",
      storage: "The Notes database, synced with iCloud",
      platforms: "Mac, iPhone, iPad, iCloud.com",
    },
    rows: [
      ["Format", "Markdown and plain text", "Rich text"],
      ["Code files", "Syntax highlighting", "—"],
      ["Export", "HTML and PDF", "PDF"],
    ],
    familiar: [
      ["Simple from the start", "Open the app and type. No setup, no onboarding, no account."],
      ["Native feel", "A quiet Mac window that follows your light or dark appearance."],
      ["Checklists", "Markdown task lists render as checkboxes in the preview."],
    ],
    different: [
      ["Files you own", "Notes are <code>.md</code> files in a folder. Back them up, version them with Git or open them in any app."],
      ["Markdown and preview", "Write in Markdown with smart lists and shortcuts, and see the result side by side."],
      ["Built for long text", "Zen mode, a readable line width and slides from Markdown for longer writing."],
      ["Open source", "Apache License 2.0."],
    ],
    better: [
      "You need your notes on iPhone and iPad with zero setup.",
      "You use drawings, scanned documents or shared notes.",
      "You prefer rich text formatting over Markdown.",
    ],
    faq: [
      ["Is kayet a replacement for Apple Notes?", "If you want notes as plain Markdown files with a live preview and workspace search, yes. If you depend on iPhone sync and sharing, Apple Notes remains easier."],
      ["Where does kayet store notes?", "In a folder on your Mac, <code>~/.kayet/workspace</code> by default. You can point it at any folder, including one in iCloud Drive."],
      ["Is kayet free?", "Yes. kayet is free and open source, with no paid tiers."],
    ],
  },
  {
    slug: "drafts",
    name: "Drafts",
    kind: "writing app",
    lead: "Drafts is built for capturing text and sending it elsewhere with actions. kayet is built for staying with the text: a quiet editor for Markdown files that you write and keep.",
    them: {
      price: "Free, Pro subscription",
      source: "Closed source",
      storage: "Its own database, synced with iCloud",
      platforms: "Mac, iPhone, iPad, Apple Watch",
    },
    rows: [
      ["Automation", "—", "Actions and scripting"],
      ["Markdown preview", "Live split pane", "Preview"],
      ["Code files", "Syntax highlighting", "Syntax definitions"],
    ],
    familiar: [
      ["Open and type", "kayet opens straight to the editor. Create a new document with <kbd>⌘</kbd><kbd>N</kbd> and start writing."],
      ["Keyboard driven", "A command palette with every command and its shortcut."],
      ["Markdown aware", "Smart lists, emphasis shortcuts and links from pasted URLs."],
    ],
    different: [
      ["Files, not drafts", "Every document is a file in a folder you choose, with a file tree and workspace search."],
      ["Long-form friendly", "Zen mode, a readable column width, HTML / PDF export and presentations."],
      ["No subscription", "Free and open source. Every feature included."],
      ["Edit code too", "Source and config files open with syntax highlighting."],
    ],
    better: [
      "You capture quick notes on iPhone or Apple Watch.",
      "You process text with actions and send it to other apps and services.",
    ],
    faq: [
      ["Is kayet a free alternative to Drafts on Mac?", "For writing and editing on the Mac, yes. kayet is free and open source, though it has no automation actions or mobile apps."],
      ["Can I open kayet from the terminal?", "Yes. Install the <code>kayet</code> command from the app menu, then run <code>kayet notes.md</code> or <code>kayet .</code>."],
    ],
  },
  {
    slug: "byword",
    name: "Byword",
    kind: "Markdown editor",
    lead: "Byword was one of the first simple Markdown editors for the Mac. kayet carries the same spirit forward: a minimal, modern editor that is free and open source.",
    them: {
      price: "Paid",
      source: "Closed source",
      storage: "Plain text / Markdown files",
      platforms: "Mac, iPhone, iPad",
    },
    rows: [
      ["Markdown preview", "Live split pane with scroll sync", "Preview"],
      ["Workspace", "File tree, file finder and search", "—"],
      ["Presentations", "Slides from <code>---</code> sections", "—"],
    ],
    familiar: [
      ["Minimal by design", "A clean page and nothing else. Controls appear only when you move to the top of the window."],
      ["Plain files", "Markdown and text files on your disk, opened from Finder or the terminal."],
      ["Focus", "Zen mode centers the current line and dims the rest."],
    ],
    different: [
      ["A whole folder", "Browse a folder of notes, jump to files with <kbd>⌘</kbd><kbd>P</kbd> and search them all with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>."],
      ["Tabs when you need them", "Open several documents in tabs that come back on the next launch."],
      ["Crash recovery", "Unsaved changes are backed up as you type and offered back after an unexpected quit."],
      ["Free and open source", "Apache License 2.0, actively developed on GitHub."],
    ],
    better: [
      "You want a companion app on iPhone and iPad.",
      "You run an Intel Mac. kayet requires Apple Silicon.",
    ],
    faq: [
      ["Is kayet a good Byword alternative?", "If you liked Byword's simplicity, kayet offers the same minimal approach to Markdown with a live preview, workspace, tabs and export, for free."],
      ["Does kayet work on Intel Macs?", "No. kayet is built for macOS on Apple Silicon."],
    ],
  },
  {
    slug: "sublime-text",
    name: "Sublime Text",
    kind: "text editor",
    lead: "Sublime Text is a fast editor for programmers. kayet is just as quick to start but built for prose first: Markdown with a live preview, zen mode and hidden chrome, with code highlighting when you need it.",
    them: {
      price: "Paid license, free evaluation",
      source: "Closed source",
      storage: "Plain files",
      platforms: "Mac, Windows, Linux",
    },
    rows: [
      ["Focus", "Writing and Markdown", "Programming"],
      ["Markdown preview", "Built in, live", "Through packages"],
      ["Plugins", "None, by design", "Large package ecosystem"],
      ["Multiple cursors", "—", "Yes"],
    ],
    familiar: [
      ["Go to anything", "<kbd>⌘</kbd><kbd>P</kbd> finds files, <kbd>⌘</kbd><kbd>K</kbd> runs commands and <kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd> searches the workspace."],
      ["Fast", "Native Rust under the hood. kayet starts instantly."],
      ["Settings in a file", "All configuration is in one text file, <code>~/.kayet/config.toml</code>."],
    ],
    different: [
      ["Prose first", "Smart Markdown lists, emphasis shortcuts, spell check and a live preview with HTML and PDF export."],
      ["Calmer window", "No minimap, gutter or status bar. The title bar hides until you need it."],
      ["Zen mode", "The current line stays centered and other paragraphs are dimmed."],
      ["Free and open source", "No license, no evaluation nag. Apache License 2.0."],
    ],
    better: [
      "You write code all day and rely on multiple cursors, build systems and packages.",
      "You work on Windows or Linux, or with very large files.",
    ],
    faq: [
      ["Is kayet a Sublime Text alternative?", "For writing, notes and Markdown, yes. For programming work that depends on packages and multiple cursors, Sublime Text is the better fit."],
      ["Does kayet highlight code?", "Yes. Source code and data / config files are highlighted by file extension with a muted palette, and highlighting can be turned off."],
    ],
  },
  {
    slug: "bbedit",
    name: "BBEdit",
    kind: "text editor",
    lead: "BBEdit is the veteran Mac text editor with tools for everything. kayet does far less on purpose: a quiet window for writing Markdown and editing text, free and open source.",
    them: {
      price: "Free mode, paid license for all features",
      source: "Closed source",
      storage: "Plain files",
      platforms: "Mac",
    },
    rows: [
      ["Focus", "Writing and Markdown", "Text, code and data processing"],
      ["Markdown preview", "Live split pane with scroll sync", "Preview window"],
      ["Text tools", "Find and replace with regular expressions", "Extensive grep, text factories, clippings"],
    ],
    familiar: [
      ["A Mac app", "A native-feeling Mac editor that opens files from Finder and from the terminal."],
      ["Regular expressions", "Find and replace supports match case, whole words and regular expressions."],
      ["Projects as folders", "Open a folder as a workspace and browse it in a file tree."],
    ],
    different: [
      ["Minimal interface", "No toolbars or panels on screen while you write. Everything is in the <kbd>⌘</kbd><kbd>K</kbd> palette."],
      ["Writing tools", "Zen mode, spell check, smart Markdown editing, slides and HTML / PDF export."],
      ["Modern themes", "Eight built-in color themes for light and dark, plus your own."],
      ["Open source", "Apache License 2.0."],
    ],
    better: [
      "You do heavy text processing, multi-file grep or work with very large files.",
      "You need text factories, clippings, shell worksheets or extensive scripting.",
    ],
    faq: [
      ["Is kayet a simpler alternative to BBEdit?", "Yes. kayet focuses on distraction-free writing and light editing, and leaves out the advanced text-processing tools BBEdit is known for."],
      ["Is kayet free?", "Yes, completely. There is no free mode and paid mode, every feature is included."],
    ],
  },
  {
    slug: "textedit",
    name: "TextEdit",
    kind: "text editor",
    lead: "TextEdit is fine for a quick note, but it defaults to rich text and knows nothing about Markdown. kayet is a free upgrade for plain text: Markdown preview, tabs, a file tree and search.",
    them: {
      price: "Free, built into macOS",
      source: "Closed source",
      storage: "Files (rich text by default)",
      platforms: "Mac",
    },
    rows: [
      ["Default format", "Plain text and Markdown", "Rich text (RTF)"],
      ["Markdown preview", "Live split pane", "—"],
      ["Syntax highlighting", "By file extension", "—"],
      ["Workspace search", "<kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>", "—"],
    ],
    familiar: [
      ["Simple", "Opens instantly to a blank page. Type and save."],
      ["Native", "Opens <code>.md</code> and <code>.txt</code> files from Finder with Open With → kayet."],
      ["Spell check", "Native macOS spelling underlines, without autocorrect rewriting your words."],
    ],
    different: [
      ["Plain text first", "No stray formatting, no RTF. What you type is exactly what is saved."],
      ["Markdown built in", "Smart lists, emphasis shortcuts, live preview and export to HTML and PDF."],
      ["Folders, tabs and search", "A workspace file tree, tabs that persist and search across every file."],
      ["Never lose a word", "Unsaved changes are backed up as you type."],
    ],
    better: [
      "You need rich text with fonts, colors and embedded tables.",
      "You only open a text file once in a while and don't want to install anything.",
    ],
    faq: [
      ["What is a good TextEdit alternative for Markdown?", "kayet is a free, open-source Mac editor for Markdown and plain text, with a live preview, file tree, tabs, workspace search and HTML / PDF export."],
      ["Can kayet open TXT files?", "Yes. kayet opens plain text, Markdown and source code files."],
    ],
  },
];

// The second footer line; index.html and privacy.html carry a copy, keep them in sync.
const footerAlternatives = (indent: string) =>
  `${indent}<span>Alternative to</span>\n` +
  ALTS.map((o) => `${indent}<a href="/alternatives/${o.slug}.html">${o.name}</a>`).join(`\n${indent}<span class="dot">·</span>\n`);

const esc = (s: string) => s.replace(/&(?![a-z#0-9]+;)/g, "&amp;");
const strip = (s: string) => s.replace(/<[^>]+>/g, "");

const APPLE = `<svg class="apple" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`;
const GITHUB = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

function page(a: Alt): string {
  const url = `${SITE}/alternatives/${a.slug}.html`;
  const title = `Free ${a.name} alternative for Mac — kayet`;
  const description = `Looking for a ${a.name} alternative? kayet is a free, open-source, distraction-free ${a.kind === "text editor" ? "text editor" : "Markdown editor"} for macOS that keeps your writing in plain files.`;
  const rows: [string, string, string][] = [
    ...(Object.keys(ROW_LABELS) as Row[]).map((k): [string, string, string] => [ROW_LABELS[k], KAYET[k], a.them[k]]),
    ...(a.rows ?? []),
  ];
  const others = ALTS.filter((o) => o.slug !== a.slug);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "kayet",
      url: SITE,
      applicationCategory: "ProductivityApplication",
      operatingSystem: "macOS (Apple Silicon)",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      downloadUrl: DMG,
      license: "https://www.apache.org/licenses/LICENSE-2.0",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: a.faq.map(([q, ans]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: strip(ans) },
      })),
    },
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" type="image/png" href="../favicon.png">
  <script>
    // Apply the saved theme before first paint to avoid a flash.
    document.documentElement.classList.add("js");
    try {
      const t = localStorage.getItem("kayet-theme");
      if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    } catch {}
  </script>
  <link rel="stylesheet" href="../style.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <script
    defer
    data-website-id="dfid_xoqqR7xpRSlGMprjMQ5qw"
    data-domain="getkayet.app"
    src="https://datafa.st/js/script.js">
  </script>
</head>
<body>
  <header class="nav">
    <a class="nav-brand" href="/">
      <img src="../icon.png" alt="" width="22" height="22">
      <span>kayet</span>
    </a>
    <nav class="nav-links">
      <a href="https://github.com/pwittchen/kayet" aria-label="GitHub">${GITHUB}<span>GitHub</span></a>
      <button class="theme-toggle" type="button" aria-label="Theme: System" title="Theme: System">
        <svg class="i-system" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>
        <svg class="i-light" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>
        <svg class="i-dark" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
      </button>
    </nav>
  </header>

  <main id="top">
    <section class="hero alt-hero">
      <img class="hero-icon reveal" src="../icon.png" alt="kayet app icon" width="96" height="96">
      <p class="alt-eyebrow reveal">${a.name} alternative</p>
      <h1 class="reveal">The free, open-source ${a.name} alternative for Mac.</h1>
      <p class="hero-sub reveal">${esc(a.lead)}</p>
      <div class="hero-cta reveal">
        <a class="btn btn-primary" href="${DMG}">${APPLE}Download kayet</a>
        <a class="btn btn-link" href="/">See all features <span aria-hidden="true">›</span></a>
      </div>
    </section>

    <section class="alt-section">
      <h2 class="reveal">kayet vs ${a.name} at a glance</h2>
      <div class="alt-table-wrap reveal">
        <table class="alt-table">
          <thead><tr><th scope="col"></th><th scope="col">kayet</th><th scope="col">${a.name}</th></tr></thead>
          <tbody>
${rows.map(([f, k, t]) => `            <tr><th scope="row">${f}</th><td>${esc(k)}</td><td>${esc(t)}</td></tr>`).join("\n")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="alt-section">
      <h2 class="reveal">What will feel familiar</h2>
      <div class="grid">
${a.familiar.map(([h, p]) => `        <article class="card reveal"><h3>${h}</h3><p>${esc(p)}</p></article>`).join("\n")}
      </div>
    </section>

    <section class="alt-section">
      <h2 class="reveal">Where kayet is different</h2>
      <div class="config-notes alt-notes reveal">
${a.different.map(([h, p]) => `        <p><strong>${h}</strong>${esc(p)}</p>`).join("\n")}
      </div>
    </section>

    <section class="alt-section">
      <h2 class="reveal">When ${a.name} is the better choice</h2>
      <p class="alt-lead reveal">kayet does less on purpose. Stay with ${a.name} if:</p>
      <ul class="alt-list reveal">
${a.better.map((b) => `        <li>${esc(b)}</li>`).join("\n")}
      </ul>
    </section>

    <section class="alt-section">
      <h2 class="reveal">Questions</h2>
      <div class="alt-faq">
${a.faq.map(([q, ans]) => `        <div class="reveal"><h3>${q}</h3><p>${esc(ans)}</p></div>`).join("\n")}
      </div>
    </section>

    <section class="download">
      <img class="reveal" src="../icon.png" alt="" width="72" height="72">
      <h2 class="reveal">Start writing.</h2>
      <p class="reveal">Free and open source. Requires macOS on Apple Silicon.</p>
      <div class="reveal">
        <a class="btn btn-primary" href="${DMG}">${APPLE}Download for Mac</a>
        <p class="note">Signed and notarized. <a href="https://github.com/pwittchen/kayet/releases">Release notes &amp; previous versions</a>.</p>
      </div>
    </section>

    <section class="alt-section alt-more">
      <h2 class="reveal">Other comparisons</h2>
      <p class="alt-others reveal">${others.map((o) => `<a href="/alternatives/${o.slug}.html">${o.name}</a>`).join(" ")}</p>
      <p class="alt-disclaimer">${a.name} is a trademark of its respective owner. kayet is an independent project, not affiliated with or endorsed by the makers of ${a.name}. The comparison reflects publicly available information as of October 2026 and may change.</p>
    </section>
  </main>

  <footer class="footer">
    <div class="footer-row">
      <a href="/">kayet</a>
      <span class="dot">·</span>
      <a href="https://github.com/pwittchen/kayet">GitHub</a>
      <span class="dot">·</span>
      <a href="https://github.com/pwittchen/kayet/blob/master/LICENSE">License</a>
      <span class="dot">·</span>
      <a href="/privacy.html">Privacy</a>
    </div>
    <div class="footer-row">
${footerAlternatives("      ")}
    </div>
  </footer>

  <script type="module" src="../script.js"></script>
</body>
</html>
`;
}

const dir = new URL("./alternatives/", import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
for (const a of ALTS) writeFileSync(`${dir}${a.slug}.html`, page(a));
console.log(`Generated ${ALTS.length} alternative pages in alternatives/`);
