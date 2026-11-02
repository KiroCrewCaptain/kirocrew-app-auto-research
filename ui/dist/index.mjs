import { activeLocale, useAppApi, useImeGuard, useLanguageGeneration } from "@kirocrew/app-sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BookOpen, Check, CheckCircle, ChevronDown, ChevronRight, Circle, ExternalLink, FileText, Flame, FlaskConical, GitFork, HelpCircle, Info, Loader2, Lock, MessageCircle, Pause, Play, Plus, RefreshCw, Search, Sparkles, Square, ThumbsUp, Trash2, X, XCircle } from "lucide-react";
import * as ui from "@kirocrew/app-sdk/ui";
import { Btn, Clickable, ErrorNotice, MarkdownRenderer, Modal } from "@kirocrew/app-sdk/ui";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
// src/paths.ts
/** The API prefix the manifest's `permissions.api` grants. */
var API = "/api/apps/auto-research";
/**
* The SSE stream of one campaign's events, on this app's own path. The page
* opens it with the browser's `EventSource` (same origin, the dashboard's
* session cookie), as the built-in did: the scoped client has no streaming call.
*/
function campaignStreamUrl(id) {
	return `${API}/campaigns/${encodeURIComponent(id)}/stream`;
}
// src/api.ts
/** Before the root mounts (tests, or a module evaluated early): a plain fetch. */
var sameOriginFetch = { async raw(path, init) {
	const r = await fetch(path, {
		credentials: "same-origin",
		...init
	});
	if (!r.ok) {
		const text = await r.text().catch(() => r.statusText);
		throw Object.assign(/* @__PURE__ */ new Error(`API ${r.status}: ${text}`), {
			status: r.status,
			body: text
		});
	}
	return r;
} };
var transport = sameOriginFetch;
/** Route every call through *next* (the page root passes `useAppApi()`). */
function setTransport(next) {
	transport = next ?? sameOriginFetch;
}
/** A refused call: the HTTP status, the backend's `error` sentence and its raw body. */
var ApiError = class extends Error {
	status;
	body;
	constructor(status, message, body) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
};
function backendMessage(status, body) {
	try {
		const parsed = JSON.parse(body);
		if (parsed && typeof parsed === "object") {
			const error = parsed.error;
			if (typeof error === "string" && error) return error;
		}
	} catch {}
	return body.trim() || `HTTP ${status}`;
}
function toApiError(err) {
	if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
		const status = err.status;
		const raw = err.body;
		const body = typeof raw === "string" ? raw : "";
		return new ApiError(status, backendMessage(status, body), body);
	}
	return err;
}
async function call(method, path, body) {
	const init = { method };
	if (body !== void 0) {
		init.headers = { "Content-Type": "application/json" };
		init.body = JSON.stringify(body);
	}
	let r;
	try {
		r = await transport.raw(API + path, init);
	} catch (err) {
		throw toApiError(err);
	}
	if (r.status === 204) return void 0;
	const text = await r.text();
	return text.trim() === "" ? void 0 : JSON.parse(text);
}
var get = (path) => call("GET", path);
var post = (path, body) => call("POST", path, body ?? {});
var patch = (path, body) => call("PATCH", path, body);
var del = (path) => call("DELETE", path);
var api = {
	researchValidate: (body) => post("/validate", body),
	researchGrillExpand: (body) => post("/grill/expand", body),
	researchCampaigns: () => get("/campaigns"),
	researchCampaign: (id) => get("/campaigns/" + id),
	researchCreate: (body) => post("/campaigns", body),
	researchAction: (id, action, body) => patch("/campaigns/" + id, {
		action,
		...body
	}),
	researchGrillTree: (id) => get("/campaigns/" + id + "/grill-tree"),
	researchNudge: (id, text) => post("/campaigns/" + id + "/nudge", { text }),
	researchAddQuestion: (id, text) => post("/campaigns/" + id + "/questions", { text }),
	researchToKnowledge: (id) => post("/campaigns/" + id + "/to-knowledge", {}),
	researchKnowledgeStatus: (id) => get("/campaigns/" + id + "/knowledge-status"),
	researchToArtifact: (id) => post("/campaigns/" + id + "/to-artifact", {}),
	researchReportStatus: (id) => get("/campaigns/" + id + "/report-status"),
	researchReport: (id) => get("/campaigns/" + id + "/report"),
	researchDelete: (id) => del("/campaigns/" + id),
	/** The model picker's list, through this app's own route (see backend `_handle_models`). */
	researchModels: () => get("/models")
};
// src/NativeSelect.tsx
/**
* The fallback for `Select` on a host that does not export one: a plain native
* `<select>` with the same props, so the call sites do not branch.
*/
function NativeSelect({ options, optionLabels, value, onChange, clearLabel, disabled, "aria-label": ariaLabel, title, className }) {
	const emptyRow = clearLabel !== void 0 || !options.includes(value);
	return /* @__PURE__ */ jsxs("select", {
		value,
		onChange: (e) => onChange(e.target.value),
		disabled,
		"aria-label": ariaLabel,
		title,
		className: "text-sm px-2 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]" + (className ? ` ${className}` : ""),
		children: [emptyRow && /* @__PURE__ */ jsx("option", {
			value: "",
			children: clearLabel ?? ""
		}), options.map((option, index) => /* @__PURE__ */ jsx("option", {
			value: option,
			children: optionLabels?.[index] ?? option
		}, option))]
	});
}
// src/hostSdk.ts
/**
* Host names added at App Kit level 1, feature-detected.
*
* A named import of an export the host's module does not have fails the whole
* bundle at link time, so a host older than these seams would show a broken page
* instead of a slightly plainer one. These names are therefore read off namespace
* imports, each through an `in` check, and each has a local fallback. Names every
* supported host has are named-imported where they are used.
*/
/** The host's inline dropdown, or a native `<select>` on a host without one. */
var Select = ("Select" in ui ? ui.Select : void 0) ?? NativeSelect;
// src/models.ts
var AUTO_ONLY = [{
	name: "auto",
	description: ""
}];
/**
* The model picker's list. The built-in read the dashboard's shared
* `useAvailableModels()`; an app page has no such hook and `/api/models` is
* outside this app's API grant, so the list comes through the app's own
* `GET /models` route, which answers with the host's list for the same caller.
* Until it arrives, or when the host cannot list models, only `auto` is
* offered, and the picker shows just "Default (inherit)".
*/
function useAvailableModels() {
	const { data } = useQuery({
		queryKey: ["research-available-models"],
		queryFn: async () => {
			const rows = await api.researchModels();
			return Array.isArray(rows) ? rows.filter((r) => !!r && typeof r.name === "string") : AUTO_ONLY;
		},
		staleTime: 6e4,
		retry: false
	});
	return data ?? AUTO_ONLY;
}
// src/grillTreeModel.ts
var map = (t, id, fn) => t.map((n) => n.id === id ? fn(n) : n);
/** ids of node + all its descendants (for prune). */
function subtreeIds(tree, id) {
	const out = /* @__PURE__ */ new Set([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const n of tree) if (n.parent && out.has(n.parent) && !out.has(n.id)) {
			out.add(n.id);
			grew = true;
		}
	}
	return out;
}
function grillReducer(tree, a) {
	switch (a.type) {
		case "addChildren": return tree.concat(a.nodes.map((n) => n.kind === "research" ? {
			...n,
			status: "promoted"
		} : n));
		case "setAnswer": return map(tree, a.id, (n) => ({
			...n,
			answer: a.answer,
			status: "answered"
		}));
		case "accept": return map(tree, a.id, (n) => ({
			...n,
			answer: n.recommended,
			status: "answered"
		}));
		case "investigateInstead": return map(tree, a.id, (n) => ({
			...n,
			kind: "research",
			origin: "grill",
			status: "promoted",
			recommended: "",
			answer: ""
		}));
		case "togglePromote": return map(tree, a.id, (n) => n.kind === "research" ? {
			...n,
			status: n.status === "promoted" ? "open" : "promoted"
		} : n);
		case "prune": {
			const ids = subtreeIds(tree, a.id);
			return tree.map((n) => ids.has(n.id) ? {
				...n,
				status: "pruned"
			} : n);
		}
		case "edit": return map(tree, a.id, (n) => ({
			...n,
			text: a.text
		}));
		default: return tree;
	}
}
/** Depth-first order over non-pruned nodes (children grouped under each parent). */
function depthFirst(tree) {
	const live = tree.filter((n) => n.status !== "pruned");
	const byParent = /* @__PURE__ */ new Map();
	for (const n of live) {
		const k = n.parent;
		(byParent.get(k) ?? byParent.set(k, []).get(k)).push(n);
	}
	const out = [];
	const walk = (parent) => {
		for (const n of byParent.get(parent) ?? []) {
			out.push(n);
			walk(n.id);
		}
	};
	walk(null);
	return out;
}
/** Promoted research sub-questions, depth-first, as {text, origin}. */
function promotedResearch(tree) {
	return depthFirst(tree).filter((n) => n.kind === "research" && n.status === "promoted" && n.text.trim()).map((n) => ({
		text: n.text.trim(),
		origin: n.origin || "grill"
	}));
}
/** Answered clarifiers as scope constraints {q, a}, excluding pruned/empty. */
function answeredClarifiers(tree) {
	return tree.filter((n) => n.kind === "clarifier" && n.status === "answered" && n.answer.trim()).map((n) => ({
		q: n.text.trim(),
		a: n.answer.trim()
	}));
}
/** Depth of a node (root = 0); -1 if absent. Mirrors backend _node_depth. */
function nodeDepth(tree, id) {
	const byId = new Map(tree.map((n) => [n.id, n]));
	if (!byId.has(id)) return -1;
	let depth = 0;
	let cur = byId.get(id);
	const seen = /* @__PURE__ */ new Set();
	while (cur && cur.parent && !seen.has(cur.id)) {
		seen.add(cur.id);
		depth += 1;
		cur = byId.get(cur.parent);
		if (!cur) break;
	}
	return depth;
}
/** Suggested max_cycles from committed sub-question count: N + ceil(N/3) + 1. */
function suggestedMaxCycles(n) {
	return n > 0 ? n + Math.ceil(n / 3) + 1 : 0;
}
// src/i18n.ts
/**
* The app's own strings. A bundle cannot read the dashboard's catalogs (those
* belong to the host and change with it), so every locale the dashboard ships is
* bundled here and looked up against the host's active language.
*
* The catalogs (`ui/i18n/<locale>.json`) are the `apps.autoResearch.*` subtree
* copied from Kiro Crew's dashboard catalogs (for English, its generated and
* hand-authored catalogs merged), under the SAME key paths, so every call site
* reads as it did in the built-in.
*
* Lookup order: the exact locale (`pt`, `zh-CN`), then its base language, then
* English, then the key itself. A numeric `count` selects the plural form the
* locale's rules name (`_one`, `_few`, `_many`, `_other`), as the dashboard's own
* catalogs are keyed. `{{name}}` placeholders are filled from `vars`; one with no
* value is left as written.
*
* `t` reads the language at call time. The root component subscribes to the
* host's language changes (`useLanguageGeneration`), and its re-render reaches
* every child, so a language switch repaints the page without a reload.
*/
var CATALOGS = {
	bn: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"গ্রহণ করুন\",\"answer\":\"উত্তর দিন…\",\"answered\":\"উত্তর দেওয়া হয়েছে:\",\"clarifier_answer\":\"স্পষ্টীকরণের উত্তর\",\"collapse\":\"সংকুচিত করো\",\"excluded\":\"বাদ দেওয়া\",\"expand\":\"প্রসারিত করুন\",\"expand_2\":\"প্রসারিত করো\",\"included\":\"অন্তর্ভুক্ত\",\"investigate_instead\":\"বরং অনুসন্ধান করুন\",\"max_depth_add_research_manually_or_prune\":\"সর্বোচ্চ গভীরতা — নিজে গবেষণা যোগ করুন বা ছেঁটে ফেলুন\",\"no_suggestions_add_manually_or_retry\":\"কোনো পরামর্শ নেই — নিজে যোগ করুন বা আবার চেষ্টা করুন\",\"prune\":\"ছেঁটে ফেলুন\",\"rec\":\"সুপারিশ:\",\"research_question\":\"গবেষণা প্রশ্ন\",\"tree_is_getting_large_consider_pruning_branches\":\"ট্রি অনেক বড় হয়ে যাচ্ছে — যে শাখাগুলো অনুসরণ করবেন না সেগুলো ছেঁটে ফেলার কথা ভাবুন।\"},\"manifest\":{\"description\":\"বহু-চক্রের রিসার্চ ক্যাম্পেইন চালায়, যা তুমি সরে গেলেও কাজ করে যায়। একটি প্রশ্ন দাও, আর এটি সেটিকে আরও সংকীর্ণ উপ-প্রশ্নের একটি ট্রিতে ছড়িয়ে দেয়, প্রতিটি খতিয়ে দেখতে এজেন্ট পাঠায়, এবং ফলাফল আসার সঙ্গে সঙ্গে পেজে স্ট্রিম করে। প্রশ্নের উত্তর পাওয়া পর্যন্ত, বা অগ্রগতি থেমে গেছে বুঝতে পারা পর্যন্ত ক্যাম্পেইন নিজে থেকেই চলে; আর শেষ হওয়া রিপোর্ট তুমি তোমার নলেজ লাইব্রেরিতে বা একটি শেয়ারযোগ্য আর্টিফ্যাক্টে পাঠিয়ে দিতে পারো।\",\"display_name\":\"Research Lab\",\"use_case_1\":\"এমন বহু-চক্রের অনুসন্ধান চালান যা বিস্তৃত প্রশ্নকে প্রসারিত করে, প্রমাণ ধারাবাহিকভাবে দেখায় এবং পুনর্ব্যবহারযোগ্য প্রতিবেদন তৈরি করে।\",\"configuration_1\":\"একটি campaign তৈরি করে Agent বা Dynamic Workflow mode বেছে নিন, প্রশ্নটি প্রসারিত করুন, তারপর cycle, interval, worker এবং attended বা unattended পরিচালনা ঠিক করুন।\",\"highlight_1\":\"এজেন্টের সময় খরচ করার আগে একটি বড় প্রশ্নকে উপ-প্রশ্নের একটি সীমিত ট্রিতে ভেঙে নেয়\",\"highlight_2\":\"তুমি দুবার খোঁজ নেওয়ার মাঝেও ক্যাম্পেইন রিসার্চ চালিয়ে যায়, আর ফলাফল লাইভ স্ট্রিম হয়\",\"highlight_3\":\"অনন্তকাল ঘুরপাক না খেয়ে, ক্যাম্পেইনের অগ্রগতি থেমে গেলে তা ধরতে পারে\",\"highlight_4\":\"সঙ্গে-থাকা মোডে সিদ্ধান্ত দরকার হলে থেমে তোমাকে প্রশ্ন করে; নজরদারি ছাড়া মোডে একটানা চলে\",\"highlight_5\":\"নতুন করে শুরু না করেই ক্যাম্পেইনের মাঝপথে বাড়তি প্রশ্ন যোগ করো\",\"highlight_6\":\"ড্যাশবোর্ড থেকেই যেকোনো ক্যাম্পেইন শুরু করো, থামাও ও আবার চালাও\",\"highlight_7\":\"শেষ হওয়া রিপোর্ট তোমার নলেজ লাইব্রেরিতে বা একটি শেয়ারযোগ্য আর্টিফ্যাক্টে এক্সপোর্ট করো\",\"page_label\":\"Research Lab\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"সক্রিয়\",\"adaptive\":\"(অ্যাডাপটিভ)\",\"add\":\"যোগ করো\",\"add_guidance_or_a_sub_question\":\"নির্দেশনা বা একটি উপ-প্রশ্ন যোগ করুন\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"নির্দেশনা বা একটি উপ-প্রশ্ন যোগ করুন… (Enter; নতুন লাইনের জন্য Shift+Enter)\",\"add_sub_question_manually\":\"নিজে উপ-প্রশ্ন যোগ করুন\",\"add_sub_question_manually_enter_shift_enter_for\":\"নিজে উপ-প্রশ্ন যোগ করুন (Enter; নতুন লাইনের জন্য Shift+Enter)\",\"add_to_knowledge\":\"নলেজে যোগ করো\",\"add_your_own_sub_question_or_guidance\":\"নিজের সাব-প্রশ্ন বা নির্দেশনা যোগ করুন\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"নিজের সাব-প্রশ্ন বা নির্দেশনা যোগ করুন (Enter; নতুন লাইনের জন্য Shift+Enter)\",\"added_to_knowledge\":\"নলেজে যোগ করা হয়েছে\",\"adding\":\"যোগ করা হচ্ছে…\",\"agent\":\"এজেন্ট\",\"agent_needs_input\":\"এজেন্টের ইনপুট প্রয়োজন\",\"all_checks_passed\":\"সব চেক পাস হয়েছে\",\"already_in_knowledge\":\"ইতিমধ্যেই নলেজে আছে\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"পরিমার্জনের জন্য চ্যালেঞ্জগুলোর উত্তর দিন, বা শুধু সাব-প্রশ্ন বেছে নিয়ে ফর্ক করুন।\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"পরিমার্জনের জন্য স্পষ্টীকরণ প্রশ্নগুলোর উত্তর দিন, বা শুধু সাব-প্রশ্ন বেছে নিয়ে এগিয়ে যান।\",\"answer_resume\":\"উত্তর দাও ও আবার শুরু করো\",\"back\":\"← ফিরে যান\",\"cancel\":\"বাতিল\",\"challenge_findings\":\"ফলাফল চ্যালেঞ্জ করুন →\",\"challenge_the_findings_from_question\":\"এখান থেকে পাওয়া ফলাফল চ্যালেঞ্জ করুন: \\\"{{question}}…\\\", তারপর একটি নতুন ক্যাম্পেইনে ফর্ক করুন।\",\"challenging\":\"চ্যালেঞ্জ করা হচ্ছে…\",\"continue\":\"চালিয়ে যান\",\"continue_research\":\"রিসার্চ চালিয়ে যান\",\"copied\":\"কপি হয়েছে!\",\"copy\":\"কপি করো\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"চ্যাট বা অটোপাইলটে পেস্ট করার জন্য এই সেকশনের markdown কপি করুন\",\"could_not_generate_challenges_please_try_again\":\"চ্যালেঞ্জ তৈরি করা যায়নি। আবার চেষ্টা করো।\",\"cycle\":\"সাইকেল\",\"cycles\":\"সাইকেল,\",\"cycles_2\":\"সাইকেল\",\"definition_of_done_optional\":\"সম্পন্ন হওয়ার শর্ত (ঐচ্ছিক)\",\"delete\":\"মুছুন\",\"delete_campaign\":\"ক্যাম্পেইন মুছে ফেলবেন?\",\"delete_campaign_button\":\"ক্যাম্পেইন মুছুন\",\"delete_failed\":\"মুছে ফেলা ব্যর্থ হয়েছে। আবার চেষ্টা করুন।\",\"delete_this_campaign_and_its_report_this_cannot\":\"এই ক্যাম্পেইন ও এর রিপোর্ট মুছে ফেলা হবে? এটি আর ফেরানো যাবে না।\",\"deleting\":\"মুছে ফেলা হচ্ছে…\",\"done_when\":\"সম্পন্ন যখন:\",\"dynamic_workflow\":\"ডাইনামিক ওয়ার্কফ্লো\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"ডাইনামিক ওয়ার্কফ্লো অনেক সাব-এজেন্টে ছড়িয়ে যেতে পারে, এবং বাজেট সীমা ছুঁয়ে গেলে রানটি সঙ্গে সঙ্গেই বন্ধ হয়ে যায় (চলাকালীন সংশ্লেষণ হারিয়ে যেতে পারে)। শুরুতে সাইকেল/ওয়ার্কারের সীমা রক্ষণশীল রাখুন।\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"যেমন, AI কোড রিভিউতে কোনো ব্লকিং সমস্যা পাওয়া যায় না এবং টেস্ট বিল্ড পাস করে\",\"emergent\":\"উদ্ভূত\",\"export_as_artifact\":\"আর্টিফ্যাক্ট হিসেবে এক্সপোর্ট করো\",\"exporting\":\"এক্সপোর্ট হচ্ছে…\",\"failed_to_add_to_knowledge_library\":\"নলেজ লাইব্রেরিতে যোগ করা যায়নি\",\"failed_to_export_as_artifact\":\"আর্টিফ্যাক্ট হিসেবে এক্সপোর্ট করা যায়নি\",\"failed_to_start_campaign_please_try_again\":\"ক্যাম্পেইন শুরু করা যায়নি — আবার চেষ্টা করো।\",\"findings\":\"ফলাফল\",\"findings_count\":\"ফলাফল ({{count}})\",\"findings_so_far_are_preserved_below\":\"এখন পর্যন্ত পাওয়া ফলাফল নিচে সংরক্ষিত আছে।\",\"first_cycle_in_progress\":\"প্রথম সাইকেল চলছে...\",\"focus_on\":\"কীসের উপর ফোকাস করতে হবে...\",\"fork_challenge\":\"ফর্ক ও চ্যালেঞ্জ\",\"fork_failed_no_campaign_was_created\":\"ফর্ক ব্যর্থ: কোনো ক্যাম্পেইন তৈরি হয়নি।\",\"fork_failed_please_try_again\":\"ফর্ক ব্যর্থ হয়েছে। আবার চেষ্টা করো।\",\"forked\":\"ফর্ক করা হয়েছে\",\"forked_from\":\"ফর্কের উৎস:\",\"forking\":\"ফর্ক করা হচ্ছে…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"মুক্ত-লেখা — একটি সাব-প্রশ্ন, বা এমন একটি নির্দেশ যা এজেন্ট পরবর্তী সাইকেলে অনুসরণ করবে।\",\"give_direction\":\"দিকনির্দেশ দিন\",\"goal_met\":\"লক্ষ্য পূরণ হয়েছে\",\"goal_not_yet\":\"লক্ষ্য: এখনো নয়\",\"grill_me\":\"আমাকে জেরা করো →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"গ্রিল উপলব্ধ নয় — নিচে ম্যানুয়ালি সাব-প্রশ্ন যোগ করুন।\",\"grilling\":\"জেরা চলছে…\",\"hide_report\":\"রিপোর্ট লুকাও\",\"history\":\"ইতিহাস\",\"how_do_other_teams_handle_api_rate_limiting\":\"অন্য টিমগুলো API রেট লিমিটিং কীভাবে সামলায়?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"সাব-এজেন্টের এক্সিকিউশন কীভাবে পরিচালিত হয়। দুটোই মুক্ত-প্রান্তিক রিসার্চ সামলাতে পারে। সেটআপের সময় একবারই বেছে নিন।\",\"idle_between_cycles\":\"সাইকেলের মাঝে অপেক্ষা:\",\"idle_between_cycles_2\":\"সাইকেলের মাঝে অপেক্ষা\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"সেট করা থাকলে এজেন্ট প্রতি সাইকেলে এর সঙ্গে মিলিয়ে যাচাই করে এবং শর্ত পূরণ হলে কাজ শেষ করে।\",\"loading\":\"লোড হচ্ছে...\",\"max_cycles\":\"সর্বোচ্চ সাইকেল:\",\"max_cycles_2\":\"সর্বোচ্চ সাইকেল\",\"min\":\"min\",\"min_20_characters\":\"কমপক্ষে 20 অক্ষর।\",\"model\":\"মডেল\",\"model_default_inherit\":\"ডিফল্ট (উত্তরাধিকার)\",\"model_line\":\"মডেল: {{model}}\",\"model_line_picked\":\"বেছে নেওয়া মডেল: {{model}}\",\"model_fork_hint\":\"মূল ক্যাম্পেইনের একই মডেল। বদলাতে অন্য একটি বেছে নাও।\",\"model_withheld_notice\":\"{{requested}} এখন উপলব্ধ নেই — এই ক্যাম্পেইন এর বদলে {{actual}}-এ চলছে। তোমার মডেল পছন্দ রাখা আছে এবং আবার উপলব্ধ হলে ব্যবহার করা হবে।\",\"model_withheld_notice_default\":\"{{requested}} এখন উপলব্ধ নেই — এই ক্যাম্পেইন এর বদলে ডিফল্ট মডেলে চলছে। তোমার মডেল পছন্দ রাখা আছে এবং আবার উপলব্ধ হলে ব্যবহার করা হবে।\",\"moderate\":\"মধ্যম\",\"new_campaign\":\"নতুন ক্যাম্পেইন\",\"new_campaign_2\":\"+ নতুন ক্যাম্পেইন\",\"next\":\"পরবর্তী →\",\"no_new_findings_in_the_last_5_cycles\":\"শেষ 5টি সাইকেলে নতুন কোনো ফলাফল পাওয়া যায়নি।\",\"no_report_yet\":\"এখনও কোনো রিপোর্ট নেই।\",\"nudge\":\"নাজ দিন\",\"nudge_direction\":\"নাজের দিকনির্দেশ\",\"nudge_direction_2\":\"নাজের দিকনির্দেশ\",\"one_campaign_at_a_time\":\"একবারে একটাই ক্যাম্পেইন\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"একসঙ্গে একটিই ক্যাম্পেইন — রিসার্চ কেন্দ্রীভূত গভীরতায় ভালো ফল দেয়।\",\"parallel_workers\":\"সমান্তরাল ওয়ার্কার:\",\"parallel_workers_2\":\"সমান্তরাল ওয়ার্কার\",\"pause\":\"বিরতি দিন\",\"pick_up_where_this_campaign_left_off\":\"এই ক্যাম্পেইন যেখানে থেমেছিল, সেখান থেকেই শুরু করুন।\",\"pre_flight_check\":\"প্রি-ফ্লাইট চেক:\",\"regenerate\":\"আবার তৈরি করো\",\"regenerate_the_report_updates_the_same_artifact\":\"রিপোর্ট আবার তৈরি করুন — একই আর্টিফ্যাক্ট নতুন ভার্সন হিসেবে আপডেট হবে\",\"regenerating\":\"আবার তৈরি হচ্ছে…\",\"remove_sub_question\":\"সাব-প্রশ্ন সরান\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab-কে অনুসন্ধান ও রিপোর্ট করতে বলা হয়, কাজ করতে নয়। এটি কোনো অনুমতির সীমা নয়: এর ওয়ার্কারের কাছে তোমার প্রধান এজেন্টের টুল থাকে এবং এটি ফাইল লিখতে ও কমান্ড চালাতে পারে। কোনো ক্যাম্পেইন নজরদারি ছাড়া চালানোর আগে সেই টুলগুলো পর্যালোচনা করো।\",\"research_only\":\"শুধু রিসার্চ।\",\"research_question\":\"রিসার্চ: “{{question}}”\",\"research_stalled\":\"রিসার্চ থমকে গেছে\",\"research_stopped\":\"রিসার্চ বন্ধ হয়েছে\",\"resume\":\"আবার শুরু করুন\",\"run_autonomous_research_campaigns\":\"স্বয়ংক্রিয় রিসার্চ ক্যাম্পেইন চালান\",\"run_unattended_skip_clarification_questions\":\"নজরদারি ছাড়াই চালান (স্পষ্টীকরণ প্রশ্ন বাদ দিন)\",\"s_idle\":\"s অপেক্ষা। ~\",\"scripted\":\"(স্ক্রিপ্টেড)\",\"searched_empty\":\"সার্চ করা হয়েছে (খালি):\",\"send\":\"পাঠাও\",\"sending\":\"পাঠানো হচ্ছে…\",\"show_less\":\"কম দেখান\",\"show_more\":\"আরও দেখান\",\"sources\":\"সূত্র:\",\"start_campaign\":\"ক্যাম্পেইন শুরু করো\",\"starting\":\"শুরু হচ্ছে...\",\"state_done\":\"সম্পন্ন\",\"state_failed\":\"ব্যর্থ\",\"state_needs_input\":\"ইনপুট দরকার\",\"state_paused\":\"পজ করা\",\"state_ready\":\"প্রস্তুত\",\"state_stalled\":\"স্থবির\",\"state_stopped\":\"থামানো হয়েছে\",\"state_working\":\"কাজ করছে\",\"status\":\"স্ট্যাটাস: {{status}}\",\"stop\":\"থামান\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"সাইকেলের সীমায় পৌঁছালে, ‘সম্পন্নের সংজ্ঞা’ পূরণ হলে, অগ্রগতি থেমে গেলে, বা আপনি থামালে এটি বন্ধ হয়।\",\"strong\":\"শক্তিশালী\",\"sub_question\":\"উপ-প্রশ্ন {{n}}\",\"sub_questions\":\"উপ-প্রশ্ন\",\"sub_questions_2\":\"উপ-প্রশ্ন\",\"sub_questions_guidance_count\":\"উপ-প্রশ্ন ও নির্দেশনা ({{count}})\",\"suggested_from\":\"প্রস্তাবিত, সূত্র:\",\"the_agent_is_waiting_for_your_direction\":\"এজেন্ট তোমার নির্দেশের অপেক্ষায় আছে।\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"AI নিজেই প্রতিটি রাউন্ড পরিচালনা করে — কী অনুসন্ধান করতে হবে তা ঠিক করে, সাব-এজেন্ট সামলায়, এবং ফলাফল থেকে নতুন ইঙ্গিত পাওয়া মাত্রই সেগুলো অনুসরণ করে।\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"AI আগেই একটি অর্কেস্ট্রেশন স্ক্রিপ্ট লিখে দেয়; একটি নির্ধারণবাদী রানার সাব-এজেন্ট চালানোর কাজ সামলায়, আর AI কেবল পরিকল্পনা, অনুসন্ধান ও সমন্বয় করে। পুনরায় চালানো যায়, বাজেট-সীমাবদ্ধ।\",\"the_campaign_stopped_unexpectedly\":\"ক্যাম্পেইন অপ্রত্যাশিতভাবে থেমে গেছে।\",\"up_to\":\"সর্বোচ্চ\",\"validating\":\"যাচাই করা হচ্ছে...\",\"validation_failed_check_your_connection_and_try\":\"যাচাই ব্যর্থ — তোমার কানেকশন দেখো এবং আবার চেষ্টা করো।\",\"view_report\":\"রিপোর্ট দেখুন\",\"weak\":\"দুর্বল\",\"what_do_you_want_to_research\":\"আপনি কী নিয়ে রিসার্চ করতে চান?\",\"when_should_the_agent_stop\":\"এজেন্ট কখন থামবে?\",\"your_answer\":\"আপনার উত্তর\",\"your_answer_2\":\"আপনার উত্তর...\",\"your_guidance\":\"তোমার নির্দেশনা\"}}}") },
	de: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"annehmen\",\"answer\":\"antworten…\",\"answered\":\"beantwortet:\",\"clarifier_answer\":\"Antwort auf Rückfrage\",\"collapse\":\"Einklappen\",\"excluded\":\"Ausgeschlossen\",\"expand\":\"aufklappen\",\"expand_2\":\"Ausklappen\",\"included\":\"Eingeschlossen\",\"investigate_instead\":\"stattdessen untersuchen\",\"max_depth_add_research_manually_or_prune\":\"max. Tiefe — Recherche manuell hinzufügen oder beschneiden\",\"no_suggestions_add_manually_or_retry\":\"keine Vorschläge — manuell hinzufügen oder erneut versuchen\",\"prune\":\"Bereinigen\",\"rec\":\"Empf.:\",\"research_question\":\"Recherchefrage\",\"tree_is_getting_large_consider_pruning_branches\":\"Der Baum wird groß — erwägen Sie, Zweige zu entfernen, die Sie nicht weiterverfolgen.\"},\"manifest\":{\"description\":\"Führt Recherchekampagnen über mehrere Zyklen aus, die weiterarbeiten, wenn du längst weg bist. Gib eine Frage vor, und sie wird zu einem Baum engerer Unterfragen aufgefächert; Agenten untersuchen jede einzelne, und Ergebnisse laufen live auf der Seite ein. Eine Kampagne steuert sich selbst, bis die Frage beantwortet ist oder sie merkt, dass der Fortschritt stockt, und den fertigen Bericht kannst du an deine Wissensbibliothek oder ein teilbares Artefakt übergeben.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"Fächert eine breite Frage in einen abgegrenzten Baum von Unterfragen auf, bevor Agentenzeit verbraucht wird\",\"highlight_2\":\"Kampagnen recherchieren zwischen deinen Besuchen weiter, Ergebnisse erscheinen live\",\"highlight_3\":\"Erkennt, wenn eine Kampagne keinen Fortschritt mehr macht, statt endlos zu kreisen\",\"highlight_4\":\"Der begleitete Modus hält an und fragt dich, wenn eine Entscheidung nötig ist; unbeaufsichtigt läuft er durch\",\"highlight_5\":\"Füge mitten in der Kampagne Folgefragen hinzu, ohne neu zu beginnen\",\"highlight_6\":\"Jede Kampagne im Dashboard starten, pausieren und fortsetzen\",\"highlight_7\":\"Den fertigen Bericht in deine Wissensbibliothek oder ein teilbares Artefakt exportieren\",\"page_label\":\"Research Lab\",\"use_case_1\":\"Führe eine mehrstufige Untersuchung durch, die eine breite Frage auffächert, laufend Belege liefert und einen wiederverwendbaren Bericht erstellt.\",\"configuration_1\":\"Erstelle eine Kampagne, wähle den Modus Agent oder Dynamic Workflow, erweitere die Frage und lege dann Zyklen, Intervall, Worker sowie beaufsichtigten oder unbeaufsichtigten Betrieb fest.\"},\"researchLabPage\":{\"120s\":\"120 s\",\"30s\":\"30 s\",\"60s\":\"60 s\",\"active\":\"AKTIV\",\"adaptive\":\"(adaptiv)\",\"add\":\"Hinzufügen\",\"add_guidance_or_a_sub_question\":\"Hinweis oder Unterfrage hinzufügen\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Hinweis oder Unterfrage hinzufügen… (Enter; Shift+Enter für neue Zeile)\",\"add_sub_question_manually\":\"Unterfrage manuell hinzufügen\",\"add_sub_question_manually_enter_shift_enter_for\":\"Unterfrage manuell hinzufügen (Enter; Shift+Enter für neue Zeile)\",\"add_to_knowledge\":\"Zum Wissen hinzufügen\",\"add_your_own_sub_question_or_guidance\":\"Eigene Unterfrage oder Hinweis hinzufügen\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Eigene Unterfrage oder Hinweis hinzufügen (Enter; Shift+Enter für neue Zeile)\",\"added_to_knowledge\":\"Zum Wissen hinzugefügt\",\"adding\":\"Wird hinzugefügt…\",\"agent\":\"Agent\",\"agent_needs_input\":\"Agent benötigt Eingabe\",\"all_checks_passed\":\"Alle Prüfungen erfolgreich\",\"already_in_knowledge\":\"Bereits im Wissen\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Beantworten Sie Einwände zur Verfeinerung oder wählen Sie einfach Unterfragen und verzweigen Sie.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Beantworten Sie Rückfragen zur Verfeinerung oder wählen Sie einfach Unterfragen und legen Sie los.\",\"answer_resume\":\"Antworten & fortsetzen\",\"back\":\"← Zurück\",\"cancel\":\"Abbrechen\",\"challenge_findings\":\"Ergebnisse hinterfragen →\",\"challenge_the_findings_from_question\":\"Die Ergebnisse hinterfragen von „{{question}}…“, und verzweigen Sie dann in eine neue Kampagne.\",\"challenging\":\"Wird hinterfragt…\",\"continue\":\"Weiter\",\"continue_research\":\"Recherche fortsetzen\",\"copied\":\"Kopiert!\",\"copy\":\"Kopieren\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Markdown dieses Abschnitts kopieren, um es in Chat oder Autopilot einzufügen\",\"could_not_generate_challenges_please_try_again\":\"Rückfragen konnten nicht generiert werden. Bitte versuche es erneut.\",\"cycle\":\"Zyklus\",\"cycles\":\"Zyklen,\",\"cycles_2\":\"Zyklen\",\"definition_of_done_optional\":\"Definition of Done (optional)\",\"delete\":\"Löschen\",\"delete_campaign\":\"Kampagne löschen?\",\"delete_campaign_button\":\"Kampagne löschen\",\"delete_failed\":\"Löschen fehlgeschlagen. Bitte erneut versuchen.\",\"delete_this_campaign_and_its_report_this_cannot\":\"Diese Kampagne und ihren Bericht löschen? Dies kann nicht rückgängig gemacht werden.\",\"deleting\":\"Wird gelöscht…\",\"done_when\":\"Fertig, wenn:\",\"dynamic_workflow\":\"Dynamischer Workflow\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"Ein dynamischer Workflow kann auf viele Subagenten verzweigen, und seine Budgetgrenze stoppt die Ausführung hart, wenn sie erreicht wird (eine Synthese mitten in der Ausführung kann verloren gehen). Beginnen Sie mit konservativen Zyklus-/Worker-Grenzen.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"z. B. die KI-Codeüberprüfung findet keine blockierenden Probleme und der Test-Build ist erfolgreich\",\"emergent\":\"emergent\",\"export_as_artifact\":\"Als Artefakt exportieren\",\"exporting\":\"Wird exportiert…\",\"failed_to_add_to_knowledge_library\":\"Hinzufügen zur Wissensbibliothek fehlgeschlagen\",\"failed_to_export_as_artifact\":\"Export als Artefakt fehlgeschlagen\",\"failed_to_start_campaign_please_try_again\":\"Kampagne konnte nicht gestartet werden — bitte versuche es erneut.\",\"findings\":\"Ergebnisse\",\"findings_count\":\"Ergebnisse ({{count}})\",\"findings_so_far_are_preserved_below\":\"Die bisherigen Ergebnisse sind unten erhalten.\",\"first_cycle_in_progress\":\"Erster Zyklus läuft…\",\"focus_on\":\"Fokus auf…\",\"fork_challenge\":\"Verzweigen & hinterfragen\",\"fork_failed_no_campaign_was_created\":\"Fork fehlgeschlagen: Es wurde keine Kampagne erstellt.\",\"fork_failed_please_try_again\":\"Fork fehlgeschlagen. Bitte versuche es erneut.\",\"forked\":\"Verzweigt\",\"forked_from\":\"Verzweigt von:\",\"forking\":\"Fork wird erstellt…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Freiform — eine Unterfrage oder eine Anweisung, die der Agent im nächsten Zyklus befolgen soll.\",\"give_direction\":\"Richtung vorgeben\",\"goal_met\":\"Ziel erreicht\",\"goal_not_yet\":\"Ziel: noch nicht\",\"grill_me\":\"Frag mich aus →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Nachfragen nicht verfügbar — fügen Sie Unterfragen unten manuell hinzu.\",\"grilling\":\"Wird ausgefragt…\",\"hide_report\":\"Bericht ausblenden\",\"history\":\"VERLAUF\",\"how_do_other_teams_handle_api_rate_limiting\":\"Wie handhaben andere Teams die API-Ratenbegrenzung?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"Wie die Ausführung von Subagenten orchestriert wird. Beide bewältigen offene Recherchen. Einmalig bei der Einrichtung wählen.\",\"idle_between_cycles\":\"Leerlauf zwischen Zyklen:\",\"idle_between_cycles_2\":\"Leerlauf zwischen Zyklen\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"Wenn festgelegt, prüft der Agent dies in jedem Zyklus und schließt ab, sobald es erfüllt ist.\",\"loading\":\"Wird geladen…\",\"max_cycles\":\"Max. Zyklen:\",\"max_cycles_2\":\"Max. Zyklen\",\"min\":\"Min.\",\"min_20_characters\":\"Min. 20 Zeichen.\",\"model\":\"Modell\",\"model_default_inherit\":\"Standard (übernehmen)\",\"model_line\":\"Modell: {{model}}\",\"model_line_picked\":\"Gewähltes Modell: {{model}}\",\"model_fork_hint\":\"Dasselbe Modell wie die ursprüngliche Kampagne. Wähle ein anderes, um es zu ändern.\",\"model_withheld_notice\":\"{{requested}} wird gerade nicht angeboten — diese Kampagne läuft stattdessen mit {{actual}}. Deine Modellwahl bleibt erhalten und wird wieder verwendet, sobald es angeboten wird.\",\"model_withheld_notice_default\":\"{{requested}} wird gerade nicht angeboten — diese Kampagne läuft stattdessen mit dem Standardmodell. Deine Modellwahl bleibt erhalten und wird wieder verwendet, sobald es angeboten wird.\",\"moderate\":\"Mittel\",\"new_campaign\":\"Neue Kampagne\",\"new_campaign_2\":\"+ Neue Kampagne\",\"next\":\"Weiter →\",\"no_new_findings_in_the_last_5_cycles\":\"Keine neuen Ergebnisse in den letzten 5 Zyklen.\",\"no_report_yet\":\"Noch kein Bericht.\",\"nudge\":\"Anstoßen\",\"nudge_direction\":\"Anstoßrichtung\",\"nudge_direction_2\":\"Anstoßrichtung\",\"one_campaign_at_a_time\":\"Nur eine Kampagne gleichzeitig\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"Eine Kampagne zur Zeit — Recherche profitiert von fokussierter Tiefe.\",\"parallel_workers\":\"Parallele Worker:\",\"parallel_workers_2\":\"Parallele Worker\",\"pause\":\"Pausieren\",\"pick_up_where_this_campaign_left_off\":\"Machen Sie dort weiter, wo diese Kampagne aufgehört hat.\",\"pre_flight_check\":\"Vorabprüfung:\",\"regenerate\":\"Neu generieren\",\"regenerate_the_report_updates_the_same_artifact\":\"Den Bericht neu erstellen — aktualisiert dasselbe Artefakt als neue Version\",\"regenerating\":\"Wird neu generiert…\",\"remove_sub_question\":\"Unterfrage entfernen\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab ist angewiesen, zu untersuchen und zu berichten, nicht zu handeln. Das ist keine Berechtigungsgrenze: Sein Worker hat die Tools deines Hauptagenten und kann Dateien schreiben und Befehle ausführen. Prüfe diese Tools, bevor du eine Kampagne unbeaufsichtigt laufen lässt.\",\"research_only\":\"Nur Recherche.\",\"research_question\":\"Recherchieren „{{question}}“\",\"research_stalled\":\"Recherche blockiert\",\"research_stopped\":\"Recherche gestoppt\",\"resume\":\"Fortsetzen\",\"run_autonomous_research_campaigns\":\"Autonome Recherchekampagnen ausführen\",\"run_unattended_skip_clarification_questions\":\"Unbeaufsichtigt ausführen (Rückfragen überspringen)\",\"s_idle\":\"s inaktiv. ~\",\"scripted\":\"(per Skript)\",\"searched_empty\":\"Durchsucht (leer):\",\"send\":\"Senden\",\"sending\":\"Wird gesendet…\",\"show_less\":\"Weniger anzeigen\",\"show_more\":\"Mehr anzeigen\",\"sources\":\"Quellen:\",\"start_campaign\":\"Kampagne starten\",\"starting\":\"Wird gestartet...\",\"state_done\":\"Fertig\",\"state_failed\":\"Fehlgeschlagen\",\"state_needs_input\":\"Eingabe erforderlich\",\"state_paused\":\"Pausiert\",\"state_ready\":\"Bereit\",\"state_stalled\":\"Blockiert\",\"state_stopped\":\"Gestoppt\",\"state_working\":\"Arbeitet\",\"status\":\"Status: {{status}}\",\"stop\":\"Stoppen\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"Stoppt bei der Zyklusgrenze, wenn die Definition of Done erfüllt ist, bei Stagnation oder wenn Sie stoppen.\",\"strong\":\"Stark\",\"sub_question\":\"Unterfrage {{n}}\",\"sub_questions\":\"Unterfragen\",\"sub_questions_2\":\"Unterfragen\",\"sub_questions_guidance_count\":\"Unterfragen & Hinweise ({{count}})\",\"suggested_from\":\"vorgeschlagen aus\",\"the_agent_is_waiting_for_your_direction\":\"Der Agent wartet auf deine Anweisung.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"Die KI steuert jede Runde selbst — sie entscheidet, was untersucht wird, verwaltet Subagenten und verfolgt neue Ansätze, die sich aus den Ergebnissen ergeben.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"Die KI schreibt vorab ein Orchestrierungsskript; ein deterministischer Runner verwaltet die Ausführung der Subagenten, während die KI nur plant, untersucht und synthetisiert. Wiederholbar, mit Budgetgrenze.\",\"the_campaign_stopped_unexpectedly\":\"Die Kampagne wurde unerwartet beendet.\",\"up_to\":\"Bis zu\",\"validating\":\"Wird validiert…\",\"validation_failed_check_your_connection_and_try\":\"Validierung fehlgeschlagen — prüfe deine Verbindung und versuche es erneut.\",\"view_report\":\"Bericht anzeigen\",\"weak\":\"Schwach\",\"what_do_you_want_to_research\":\"Was möchten Sie recherchieren?\",\"when_should_the_agent_stop\":\"Wann soll der Agent stoppen?\",\"your_answer\":\"Ihre Antwort\",\"your_answer_2\":\"Ihre Antwort…\",\"your_guidance\":\"deine Anweisung\"}}}") },
	en: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"accept\",\"answer\":\"answer…\",\"answered\":\"answered:\",\"clarifier_answer\":\"Clarifier answer\",\"collapse\":\"Collapse\",\"excluded\":\"Excluded\",\"expand\":\"expand\",\"expand_2\":\"Expand\",\"included\":\"Included\",\"investigate_instead\":\"investigate instead\",\"max_depth_add_research_manually_or_prune\":\"max depth — add research manually or prune\",\"no_suggestions_add_manually_or_retry\":\"no suggestions — add manually or retry\",\"prune\":\"Prune\",\"rec\":\"rec:\",\"research_question\":\"Research question\",\"tree_is_getting_large_consider_pruning_branches\":\"Tree is getting large — consider pruning branches you won't pursue.\"},\"manifest\":{\"configuration_1\":\"Create a campaign, choose Agent or Dynamic Workflow mode, expand the question, then set cycles, interval, workers, and attended or unattended operation.\",\"description\":\"Runs multi-cycle research campaigns that keep working after you walk away. Give it a question and it expands that into a tree of narrower sub-questions, sends agents to investigate each one, and streams findings to the page as they land. A campaign self-drives until the question is answered or it notices progress has stalled, and you can hand the finished report off to your knowledge library or a shareable artifact.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"Expands one broad question into a scoped tree of sub-questions before spending agent time\",\"highlight_2\":\"Campaigns keep researching between your check-ins, with findings streamed live\",\"highlight_3\":\"Notices when a campaign stops making progress instead of looping forever\",\"highlight_4\":\"Attended mode pauses to ask you a question when it needs a decision; unattended runs straight through\",\"highlight_5\":\"Add follow-up questions mid-campaign without starting over\",\"highlight_6\":\"Start, pause, and resume any campaign from the dashboard\",\"highlight_7\":\"Export the finished report to your knowledge library or a shareable artifact\",\"page_label\":\"Research Lab\",\"use_case_1\":\"Run a multi-cycle investigation that expands a broad question, streams evidence, and produces a reusable report.\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"ACTIVE\",\"adaptive\":\"(adaptive)\",\"add\":\"Add\",\"add_guidance_or_a_sub_question\":\"Add guidance or a sub-question\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Add guidance or a sub-question… (Enter; Shift+Enter for newline)\",\"add_sub_question_manually\":\"Add sub-question manually\",\"add_sub_question_manually_enter_shift_enter_for\":\"Add sub-question manually (Enter; Shift+Enter for newline)\",\"add_to_knowledge\":\"Add to Knowledge\",\"add_your_own_sub_question_or_guidance\":\"Add your own sub-question or guidance\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Add your own sub-question or guidance (Enter; Shift+Enter for newline)\",\"added_to_knowledge\":\"Added to Knowledge\",\"adding\":\"Adding…\",\"agent\":\"Agent\",\"agent_needs_input\":\"Agent needs input\",\"all_checks_passed\":\"All checks passed\",\"already_in_knowledge\":\"Already in Knowledge\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Answer challenges to refine, or just pick sub-questions and fork.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Answer clarifiers to refine, or just pick sub-questions and go.\",\"answer_resume\":\"Answer & resume\",\"back\":\"← Back\",\"cancel\":\"Cancel\",\"challenge_findings\":\"Challenge Findings →\",\"challenge_the_findings_from_question\":\"Challenge the findings from \\\"{{question}}…\\\", then fork into a new campaign.\",\"challenging\":\"Challenging…\",\"continue\":\"Continue\",\"continue_research\":\"Continue Research\",\"copied\":\"Copied!\",\"copy\":\"Copy\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Copy this section's markdown to paste into chat or autopilot\",\"could_not_generate_challenges_please_try_again\":\"Could not generate challenges. Please try again.\",\"cycle\":\"Cycle\",\"cycles\":\"cycles,\",\"cycles_2\":\"cycles\",\"definition_of_done_optional\":\"Definition of Done (optional)\",\"delete\":\"Delete\",\"delete_campaign\":\"Delete campaign?\",\"delete_campaign_button\":\"Delete campaign\",\"delete_failed\":\"Delete failed. Please try again.\",\"delete_this_campaign_and_its_report_this_cannot\":\"Delete this campaign and its report? This cannot be undone.\",\"deleting\":\"Deleting…\",\"done_when\":\"Done when:\",\"dynamic_workflow\":\"Dynamic Workflow\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"Dynamic Workflow can fan out to many sub-agents, and its budget cap stops the run hard if hit (mid-run synthesis may be lost). Start with conservative cycle/worker limits.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"e.g. AI code review finds no blocking issues and the test build passes\",\"emergent\":\"emergent\",\"export_as_artifact\":\"Export as Artifact\",\"exporting\":\"Exporting…\",\"failed_to_add_to_knowledge_library\":\"Failed to add to Knowledge Library\",\"failed_to_export_as_artifact\":\"Failed to export as artifact\",\"failed_to_start_campaign_please_try_again\":\"Failed to start campaign — please try again.\",\"findings\":\"findings\",\"findings_count\":\"Findings ({{count}})\",\"findings_so_far_are_preserved_below\":\"Findings so far are preserved below.\",\"first_cycle_in_progress\":\"First cycle in progress...\",\"focus_on\":\"Focus on...\",\"fork_challenge\":\"Fork & Challenge\",\"fork_failed_no_campaign_was_created\":\"Fork failed: no campaign was created.\",\"fork_failed_please_try_again\":\"Fork failed. Please try again.\",\"forked\":\"Forked\",\"forked_from\":\"Forked from:\",\"forking\":\"Forking…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Free-form — a sub-question or an instruction the agent should follow next cycle.\",\"give_direction\":\"Give direction\",\"goal_met\":\"Goal met\",\"goal_not_yet\":\"Goal: not yet\",\"grill_me\":\"Grill me →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Grill unavailable — add sub-questions manually below.\",\"grilling\":\"Grilling…\",\"hide_report\":\"Hide report\",\"history\":\"HISTORY\",\"how_do_other_teams_handle_api_rate_limiting\":\"How do other teams handle API rate limiting?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"How sub-agent execution is orchestrated. Both handle open-ended research. Choose once at setup.\",\"idle_between_cycles\":\"Idle between cycles:\",\"idle_between_cycles_2\":\"Idle between cycles\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"If set, the agent verifies against this each cycle and completes when met.\",\"loading\":\"Loading...\",\"max_cycles\":\"Max cycles:\",\"max_cycles_2\":\"Max cycles\",\"min\":\"min\",\"min_20_characters\":\"Min 20 characters.\",\"model\":\"Model\",\"model_default_inherit\":\"Default (inherit)\",\"model_fork_hint\":\"Same model as the original campaign. Pick another to change it.\",\"model_line\":\"Model: {{model}}\",\"model_line_picked\":\"Picked model: {{model}}\",\"model_withheld_notice\":\"{{requested}} isn't offered right now — this campaign is running on {{actual}} instead. Your model choice is kept and is used again once it's offered.\",\"model_withheld_notice_default\":\"{{requested}} isn't offered right now — this campaign is running on the default model instead. Your model choice is kept and is used again once it's offered.\",\"moderate\":\"Moderate\",\"new_campaign\":\"New Campaign\",\"new_campaign_2\":\"+ New Campaign\",\"next\":\"Next →\",\"no_new_findings_in_the_last_5_cycles\":\"No new findings in the last 5 cycles.\",\"no_report_yet\":\"No report yet.\",\"nudge\":\"Nudge\",\"nudge_direction\":\"Nudge Direction\",\"nudge_direction_2\":\"Nudge direction\",\"one_campaign_at_a_time\":\"One campaign at a time\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"One campaign at a time — research benefits from focused depth.\",\"parallel_workers\":\"Parallel workers:\",\"parallel_workers_2\":\"Parallel workers\",\"pause\":\"Pause\",\"pick_up_where_this_campaign_left_off\":\"Pick up where this campaign left off.\",\"pre_flight_check\":\"Pre-flight Check:\",\"regenerate\":\"Regenerate\",\"regenerate_the_report_updates_the_same_artifact\":\"Regenerate the report — updates the same artifact as a new version\",\"regenerating\":\"Regenerating…\",\"remove_sub_question\":\"Remove sub-question\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab is told to investigate and report, not to act. This is not a permission boundary: its worker has your main agent's tools and can write files and run commands. Review those tools before running a campaign unattended.\",\"research_only\":\"Research-only.\",\"research_question\":\"Research “{{question}}”\",\"research_stalled\":\"Research Stalled\",\"research_stopped\":\"Research stopped\",\"resume\":\"Resume\",\"run_autonomous_research_campaigns\":\"Run autonomous research campaigns\",\"run_unattended_skip_clarification_questions\":\"Run unattended (skip clarification questions)\",\"s_idle\":\"s idle. ~\",\"scripted\":\"(scripted)\",\"searched_empty\":\"Searched (empty):\",\"send\":\"Send\",\"sending\":\"Sending…\",\"show_less\":\"Show less\",\"show_more\":\"Show more\",\"sources\":\"Sources:\",\"start_campaign\":\"Start Campaign\",\"starting\":\"Starting...\",\"state_done\":\"Done\",\"state_failed\":\"Failed\",\"state_needs_input\":\"Needs input\",\"state_paused\":\"Paused\",\"state_ready\":\"Ready\",\"state_stalled\":\"Stalled\",\"state_stopped\":\"Stopped\",\"state_working\":\"Working\",\"status\":\"Status: {{status}}\",\"stop\":\"Stop\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"Stops at the cycle cap, when the Definition of Done is met, on stagnation, or when you Stop it.\",\"strong\":\"Strong\",\"sub_question\":\"Sub-question {{n}}\",\"sub_questions\":\"Sub-questions\",\"sub_questions_2\":\"sub-questions\",\"sub_questions_guidance_count\":\"Sub-questions & guidance ({{count}})\",\"suggested_from\":\"suggested from\",\"the_agent_is_waiting_for_your_direction\":\"The agent is waiting for your direction.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"The AI drives every round itself — deciding what to investigate, managing sub-agents, and following new leads from findings as they emerge.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"The AI writes an orchestration script up front; a deterministic runner manages sub-agent execution while the AI only plans, investigates, and synthesizes. Replayable, budget-capped.\",\"the_campaign_stopped_unexpectedly\":\"The campaign stopped unexpectedly.\",\"up_to\":\"Up to\",\"validating\":\"Validating...\",\"validation_failed_check_your_connection_and_try\":\"Validation failed — check your connection and try again.\",\"view_report\":\"View report\",\"weak\":\"Weak\",\"what_do_you_want_to_research\":\"What do you want to research?\",\"when_should_the_agent_stop\":\"When should the agent stop?\",\"your_answer\":\"Your answer\",\"your_answer_2\":\"Your answer...\",\"your_guidance\":\"your guidance\"}}}") },
	es: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"aceptar\",\"answer\":\"responder…\",\"answered\":\"respondido:\",\"clarifier_answer\":\"Respuesta aclaratoria\",\"collapse\":\"Contraer\",\"excluded\":\"Excluida\",\"expand\":\"expandir\",\"expand_2\":\"Expandir\",\"included\":\"Incluida\",\"investigate_instead\":\"investigar en su lugar\",\"max_depth_add_research_manually_or_prune\":\"profundidad máxima — añade investigación manualmente o poda\",\"no_suggestions_add_manually_or_retry\":\"sin sugerencias — añade manualmente o reintenta\",\"prune\":\"Podar\",\"rec\":\"rec:\",\"research_question\":\"Pregunta de investigación\",\"tree_is_getting_large_consider_pruning_branches\":\"El árbol está creciendo mucho — considera podar las ramas que no vas a seguir.\"},\"manifest\":{\"description\":\"Ejecuta campañas de investigación de varios ciclos que siguen trabajando después de que te vas. Le das una pregunta y la expande en un árbol de subpreguntas más acotadas, envía agentes a investigar cada una y transmite los hallazgos a la página a medida que llegan. Una campaña se conduce sola hasta que la pregunta queda resuelta o detecta que el avance se estancó, y puedes enviar el informe terminado a tu biblioteca de Conocimiento o a un artefacto que puedas compartir.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"Expande una pregunta amplia en un árbol acotado de subpreguntas antes de gastar tiempo de agentes\",\"highlight_2\":\"Las campañas siguen investigando entre tus revisiones, con los hallazgos transmitidos en vivo\",\"highlight_3\":\"Detecta cuando una campaña deja de avanzar en lugar de repetirse para siempre\",\"highlight_4\":\"El modo supervisado se detiene para preguntarte cuando necesita una decisión; el modo sin supervisión avanza de corrido\",\"highlight_5\":\"Agrega preguntas de seguimiento a mitad de la campaña sin empezar de nuevo\",\"highlight_6\":\"Inicia, pausa y reanuda cualquier campaña desde el panel\",\"highlight_7\":\"Exporta el informe terminado a tu biblioteca de Conocimiento o a un artefacto que puedas compartir\",\"page_label\":\"Research Lab\",\"use_case_1\":\"Realiza una investigación de varios ciclos que amplía una pregunta general, transmite las pruebas y produce un informe reutilizable.\",\"configuration_1\":\"Crea una campaña, elige el modo Agent o Dynamic Workflow, amplía la pregunta y configura los ciclos, el intervalo, los workers y el funcionamiento supervisado o autónomo.\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"ACTIVA\",\"adaptive\":\"(adaptativo)\",\"add\":\"Añadir\",\"add_guidance_or_a_sub_question\":\"Añadir indicaciones o una subpregunta\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Añadir indicaciones o una subpregunta… (Enter; Shift+Enter para nueva línea)\",\"add_sub_question_manually\":\"Añadir subpregunta manualmente\",\"add_sub_question_manually_enter_shift_enter_for\":\"Añadir subpregunta manualmente (Enter; Shift+Enter para nueva línea)\",\"add_to_knowledge\":\"Añadir a Conocimiento\",\"add_your_own_sub_question_or_guidance\":\"Añade tu propia subpregunta o indicación\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Añade tu propia subpregunta o indicación (Enter; Shift+Enter para nueva línea)\",\"added_to_knowledge\":\"Añadido a Conocimiento\",\"adding\":\"Añadiendo…\",\"agent\":\"Agente\",\"agent_needs_input\":\"El agente necesita tu respuesta\",\"all_checks_passed\":\"Todas las comprobaciones correctas\",\"already_in_knowledge\":\"Ya está en Conocimiento\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Responde a los cuestionamientos para refinar, o simplemente elige subpreguntas y bifurca.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Responde a las aclaraciones para refinar, o simplemente elige subpreguntas y adelante.\",\"answer_resume\":\"Responder y reanudar\",\"back\":\"← Atrás\",\"cancel\":\"Cancelar\",\"challenge_findings\":\"Cuestionar hallazgos →\",\"challenge_the_findings_from_question\":\"Cuestionar los hallazgos de \\\"{{question}}…\\\", y luego bifúrcala en una nueva campaña.\",\"challenging\":\"Cuestionando…\",\"continue\":\"Continuar\",\"continue_research\":\"Continuar investigación\",\"copied\":\"¡Copiado!\",\"copy\":\"Copiar\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Copiar el markdown de esta sección para pegarlo en el chat o en el autopiloto\",\"could_not_generate_challenges_please_try_again\":\"No se pudieron generar los cuestionamientos. Inténtalo de nuevo.\",\"cycle\":\"Ciclo\",\"cycles\":\"ciclos,\",\"cycles_2\":\"ciclos\",\"definition_of_done_optional\":\"Definición de Terminado (opcional)\",\"delete\":\"Eliminar\",\"delete_campaign\":\"¿Eliminar la campaña?\",\"delete_campaign_button\":\"Eliminar campaña\",\"delete_failed\":\"Error al eliminar. Inténtalo de nuevo.\",\"delete_this_campaign_and_its_report_this_cannot\":\"¿Eliminar esta campaña y su informe? Esta acción no se puede deshacer.\",\"deleting\":\"Eliminando…\",\"done_when\":\"Terminado cuando:\",\"dynamic_workflow\":\"Flujo de trabajo dinámico\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"El flujo de trabajo dinámico puede desplegarse en muchos subagentes, y su límite de presupuesto detiene la ejecución en seco si se alcanza (puede perderse la síntesis intermedia). Empieza con límites conservadores de ciclos y trabajadores.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"p. ej. la revisión de código con IA no encuentra problemas bloqueantes y la compilación de prueba pasa\",\"emergent\":\"emergente\",\"export_as_artifact\":\"Exportar como artefacto\",\"exporting\":\"Exportando…\",\"failed_to_add_to_knowledge_library\":\"No se pudo añadir a la Biblioteca de conocimiento\",\"failed_to_export_as_artifact\":\"No se pudo exportar como artefacto\",\"failed_to_start_campaign_please_try_again\":\"No se pudo iniciar la campaña — inténtalo de nuevo.\",\"findings\":\"hallazgos\",\"findings_count\":\"Hallazgos ({{count}})\",\"findings_so_far_are_preserved_below\":\"Los hallazgos obtenidos hasta ahora se conservan abajo.\",\"first_cycle_in_progress\":\"Primer ciclo en curso...\",\"focus_on\":\"Céntrate en...\",\"fork_challenge\":\"Bifurcar y cuestionar\",\"fork_failed_no_campaign_was_created\":\"Falló la bifurcación: no se creó ninguna campaña.\",\"fork_failed_please_try_again\":\"Falló la bifurcación. Inténtalo de nuevo.\",\"forked\":\"Bifurcada\",\"forked_from\":\"Bifurcada de:\",\"forking\":\"Bifurcando…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Formato libre — una subpregunta o una instrucción que el agente debe seguir en el siguiente ciclo.\",\"give_direction\":\"Dar indicaciones\",\"goal_met\":\"Objetivo alcanzado\",\"goal_not_yet\":\"Objetivo: aún no\",\"grill_me\":\"Interrógame →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Grill no disponible — añade subpreguntas manualmente abajo.\",\"grilling\":\"Interrogando…\",\"hide_report\":\"Ocultar el informe\",\"history\":\"HISTORIAL\",\"how_do_other_teams_handle_api_rate_limiting\":\"¿Cómo gestionan otros equipos la limitación de peticiones de la API?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"Cómo se orquesta la ejecución de los subagentes. Ambos sirven para investigación abierta. Se elige una sola vez en la configuración.\",\"idle_between_cycles\":\"Inactividad entre ciclos:\",\"idle_between_cycles_2\":\"Inactividad entre ciclos\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"Si se define, el agente lo verifica en cada ciclo y termina cuando se cumple.\",\"loading\":\"Cargando...\",\"max_cycles\":\"Ciclos máximos:\",\"max_cycles_2\":\"Ciclos máximos\",\"min\":\"min\",\"min_20_characters\":\"Mínimo 20 caracteres.\",\"model\":\"Modelo\",\"model_default_inherit\":\"Predeterminado (heredar)\",\"model_line\":\"Modelo: {{model}}\",\"model_line_picked\":\"Modelo elegido: {{model}}\",\"model_fork_hint\":\"El mismo modelo que la campaña original. Elige otro para cambiarlo.\",\"model_withheld_notice\":\"{{requested}} no está disponible ahora mismo — esta campaña se está ejecutando con {{actual}}. Tu elección de modelo se conserva y se volverá a usar cuando esté disponible.\",\"model_withheld_notice_default\":\"{{requested}} no está disponible ahora mismo — esta campaña se está ejecutando con el modelo predeterminado. Tu elección de modelo se conserva y se volverá a usar cuando esté disponible.\",\"moderate\":\"Moderado\",\"new_campaign\":\"Nueva campaña\",\"new_campaign_2\":\"+ Nueva campaña\",\"next\":\"Siguiente →\",\"no_new_findings_in_the_last_5_cycles\":\"Sin nuevos hallazgos en los últimos 5 ciclos.\",\"no_report_yet\":\"Aún no hay informe.\",\"nudge\":\"Orientar\",\"nudge_direction\":\"Orientar el rumbo\",\"nudge_direction_2\":\"Orientar el rumbo\",\"one_campaign_at_a_time\":\"Una campaña a la vez\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"Una campaña a la vez — la investigación se beneficia de una profundidad enfocada.\",\"parallel_workers\":\"Trabajadores paralelos:\",\"parallel_workers_2\":\"Trabajadores paralelos\",\"pause\":\"Pausar\",\"pick_up_where_this_campaign_left_off\":\"Continúa donde se quedó esta campaña.\",\"pre_flight_check\":\"Comprobación previa:\",\"regenerate\":\"Regenerar\",\"regenerate_the_report_updates_the_same_artifact\":\"Regenerar el informe — actualiza el mismo artefacto como una nueva versión\",\"regenerating\":\"Regenerando…\",\"remove_sub_question\":\"Eliminar subpregunta\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab tiene la instrucción de investigar e informar, no de actuar. No es un límite de permisos: su worker tiene las herramientas de tu agente principal y puede escribir archivos y ejecutar comandos. Revisa esas herramientas antes de ejecutar una campaña sin supervisión.\",\"research_only\":\"Solo investigación.\",\"research_question\":\"Investigar “{{question}}”\",\"research_stalled\":\"Investigación estancada\",\"research_stopped\":\"Investigación detenida\",\"resume\":\"Reanudar\",\"run_autonomous_research_campaigns\":\"Ejecuta campañas de investigación autónomas\",\"run_unattended_skip_clarification_questions\":\"Ejecutar sin supervisión (omitir las preguntas de aclaración)\",\"s_idle\":\"s inactivo. ~\",\"scripted\":\"(por script)\",\"searched_empty\":\"Buscado (vacío):\",\"send\":\"Enviar\",\"sending\":\"Enviando…\",\"show_less\":\"Mostrar menos\",\"show_more\":\"Mostrar más\",\"sources\":\"Fuentes:\",\"start_campaign\":\"Iniciar campaña\",\"starting\":\"Iniciando…\",\"state_done\":\"Completado\",\"state_failed\":\"Fallido\",\"state_needs_input\":\"Necesita respuesta\",\"state_paused\":\"En pausa\",\"state_ready\":\"Listo\",\"state_stalled\":\"Estancado\",\"state_stopped\":\"Detenido\",\"state_working\":\"Trabajando\",\"status\":\"Estado: {{status}}\",\"stop\":\"Detener\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"Se detiene al llegar al límite de ciclos, cuando se cumple la Definición de Terminado, por estancamiento o cuando pulsas Detener.\",\"strong\":\"Fuerte\",\"sub_question\":\"Subpregunta {{n}}\",\"sub_questions\":\"Subpreguntas\",\"sub_questions_2\":\"subpreguntas\",\"sub_questions_guidance_count\":\"Subpreguntas e indicaciones ({{count}})\",\"suggested_from\":\"sugerido de\",\"the_agent_is_waiting_for_your_direction\":\"El agente espera tus indicaciones.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"La IA dirige cada ronda por sí misma — decide qué investigar, gestiona los subagentes y sigue las nuevas pistas de los hallazgos a medida que surgen.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"La IA escribe un script de orquestación por adelantado; un ejecutor determinista gestiona la ejecución de los subagentes mientras la IA solo planifica, investiga y sintetiza. Reproducible y con límite de presupuesto.\",\"the_campaign_stopped_unexpectedly\":\"La campaña se detuvo de forma inesperada.\",\"up_to\":\"Hasta\",\"validating\":\"Validando...\",\"validation_failed_check_your_connection_and_try\":\"Falló la validación — revisa tu conexión e inténtalo de nuevo.\",\"view_report\":\"Ver informe\",\"weak\":\"Débil\",\"what_do_you_want_to_research\":\"¿Qué quieres investigar?\",\"when_should_the_agent_stop\":\"¿Cuándo debe detenerse el agente?\",\"your_answer\":\"Tu respuesta\",\"your_answer_2\":\"Tu respuesta...\",\"your_guidance\":\"tus indicaciones\"}}}") },
	fr: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"accepter\",\"answer\":\"répondre…\",\"answered\":\"répondu :\",\"clarifier_answer\":\"Réponse de clarification\",\"collapse\":\"Réduire\",\"excluded\":\"Exclu\",\"expand\":\"développer\",\"expand_2\":\"Développer\",\"included\":\"Inclus\",\"investigate_instead\":\"enquêter à la place\",\"max_depth_add_research_manually_or_prune\":\"profondeur maximale — ajoutez des recherches manuellement ou élaguez\",\"no_suggestions_add_manually_or_retry\":\"aucune suggestion — ajoutez manuellement ou réessayez\",\"prune\":\"Élaguer\",\"rec\":\"reco :\",\"research_question\":\"Question de recherche\",\"tree_is_getting_large_consider_pruning_branches\":\"L'arborescence devient volumineuse — envisagez d'élaguer les branches que vous ne poursuivrez pas.\"},\"manifest\":{\"description\":\"Mène des campagnes de recherche multi-cycles qui continuent de travailler après ton départ. Donne-lui une question et il la déploie en une arborescence de sous-questions plus précises, envoie des agents enquêter sur chacune et diffuse les conclusions sur la page à mesure qu’elles arrivent. Une campagne s’autopilote jusqu’à ce que la question soit résolue ou qu’elle détecte que la progression s’est arrêtée, et tu peux verser le rapport final dans ta bibliothèque de connaissances ou dans un artefact partageable.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"Déploie une question large en une arborescence délimitée de sous-questions avant de consommer du temps d’agent\",\"highlight_2\":\"Les campagnes continuent de chercher entre tes passages, avec des conclusions diffusées en direct\",\"highlight_3\":\"Détecte qu’une campagne n’avance plus au lieu de boucler indéfiniment\",\"highlight_4\":\"Le mode supervisé s’interrompt pour te poser une question quand une décision est nécessaire ; le mode sans surveillance va jusqu’au bout sans s’arrêter\",\"highlight_5\":\"Ajoute des questions complémentaires en cours de campagne, sans repartir de zéro\",\"highlight_6\":\"Démarre, mets en pause et reprends n’importe quelle campagne depuis le tableau de bord\",\"highlight_7\":\"Exporte le rapport final vers ta bibliothèque de connaissances ou un artefact partageable\",\"page_label\":\"Research Lab\",\"use_case_1\":\"Mène une enquête en plusieurs cycles qui développe une question générale, diffuse les preuves et produit un rapport réutilisable.\",\"configuration_1\":\"Crée une campagne, choisis le mode Agent ou Dynamic Workflow, développe la question, puis définis les cycles, l'intervalle, les workers et l'exécution supervisée ou autonome.\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"ACTIVE\",\"adaptive\":\"(adaptatif)\",\"add\":\"Ajouter\",\"add_guidance_or_a_sub_question\":\"Ajouter des instructions ou une sous-question\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Ajouter des instructions ou une sous-question… (Entrée ; Maj+Entrée pour un retour à la ligne)\",\"add_sub_question_manually\":\"Ajouter une sous-question manuellement\",\"add_sub_question_manually_enter_shift_enter_for\":\"Ajouter une sous-question manuellement (Entrée ; Maj+Entrée pour un retour à la ligne)\",\"add_to_knowledge\":\"Ajouter aux connaissances\",\"add_your_own_sub_question_or_guidance\":\"Ajoutez votre propre sous-question ou instruction\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Ajoutez votre propre sous-question ou instruction (Entrée ; Maj+Entrée pour un retour à la ligne)\",\"added_to_knowledge\":\"Ajouté aux connaissances\",\"adding\":\"Ajout…\",\"agent\":\"Agent\",\"agent_needs_input\":\"L'agent attend une saisie\",\"all_checks_passed\":\"Toutes les vérifications ont réussi\",\"already_in_knowledge\":\"Déjà dans les connaissances\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Répondez aux objections pour affiner, ou choisissez simplement des sous-questions et bifurquez.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Répondez aux clarifications pour affiner, ou choisissez simplement des sous-questions et lancez-vous.\",\"answer_resume\":\"Répondre et reprendre\",\"back\":\"← Retour\",\"cancel\":\"Annuler\",\"challenge_findings\":\"Contester les conclusions →\",\"challenge_the_findings_from_question\":\"Contester les conclusions de \\\"{{question}}…\\\", puis bifurquez vers une nouvelle campagne.\",\"challenging\":\"Contestation…\",\"continue\":\"Continuer\",\"continue_research\":\"Poursuivre la recherche\",\"copied\":\"Copié !\",\"copy\":\"Copier\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Copier le markdown de cette section pour le coller dans le chat ou le pilote automatique\",\"could_not_generate_challenges_please_try_again\":\"Impossible de générer les objections. Réessayez.\",\"cycle\":\"Cycle\",\"cycles\":\"cycles,\",\"cycles_2\":\"cycles\",\"definition_of_done_optional\":\"Définition de « terminé » (facultatif)\",\"delete\":\"Supprimer\",\"delete_campaign\":\"Supprimer la campagne ?\",\"delete_campaign_button\":\"Supprimer la campagne\",\"delete_failed\":\"Échec de la suppression. Veuillez réessayer.\",\"delete_this_campaign_and_its_report_this_cannot\":\"Supprimer cette campagne et son rapport ? Cette action est irréversible.\",\"deleting\":\"Suppression…\",\"done_when\":\"Terminé quand :\",\"dynamic_workflow\":\"Flux de travail dynamique\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"Le flux de travail dynamique peut se déployer sur de nombreux sous-agents, et son plafond budgétaire interrompt brutalement l'exécution s'il est atteint (la synthèse en cours peut être perdue). Commencez par des limites de cycles et de workers prudentes.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"ex. la revue de code par IA ne trouve aucun problème bloquant et la compilation de test réussit\",\"emergent\":\"émergent\",\"export_as_artifact\":\"Exporter en tant qu’artefact\",\"exporting\":\"Export en cours…\",\"failed_to_add_to_knowledge_library\":\"Échec de l’ajout à la bibliothèque de connaissances\",\"failed_to_export_as_artifact\":\"Échec de l'export en tant qu'artefact\",\"failed_to_start_campaign_please_try_again\":\"Échec du démarrage de la campagne — réessayez.\",\"findings\":\"conclusions\",\"findings_count\":\"Conclusions ({{count}})\",\"findings_so_far_are_preserved_below\":\"Les conclusions obtenues jusqu'ici sont conservées ci-dessous.\",\"first_cycle_in_progress\":\"Premier cycle en cours...\",\"focus_on\":\"Se concentrer sur...\",\"fork_challenge\":\"Bifurquer et contester\",\"fork_failed_no_campaign_was_created\":\"Échec de la bifurcation : aucune campagne n’a été créée.\",\"fork_failed_please_try_again\":\"Échec de la bifurcation. Réessayez.\",\"forked\":\"Bifurquée\",\"forked_from\":\"Bifurquée depuis :\",\"forking\":\"Bifurcation…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Format libre — une sous-question ou une instruction que l'agent devra suivre au prochain cycle.\",\"give_direction\":\"Donner une orientation\",\"goal_met\":\"Objectif atteint\",\"goal_not_yet\":\"Objectif : pas encore\",\"grill_me\":\"Interrogez-moi →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Interrogatoire indisponible — ajoutez des sous-questions manuellement ci-dessous.\",\"grilling\":\"Interrogatoire…\",\"hide_report\":\"Masquer le rapport\",\"history\":\"HISTORIQUE\",\"how_do_other_teams_handle_api_rate_limiting\":\"Comment les autres équipes gèrent-elles la limitation de débit des API ?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"Comment l'exécution des sous-agents est orchestrée. Les deux gèrent la recherche ouverte. À choisir une seule fois lors de la configuration.\",\"idle_between_cycles\":\"Inactivité entre les cycles :\",\"idle_between_cycles_2\":\"Inactivité entre les cycles\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"Si défini, l'agent s'y réfère à chaque cycle et termine lorsque la condition est remplie.\",\"loading\":\"Chargement...\",\"max_cycles\":\"Cycles max :\",\"max_cycles_2\":\"Cycles max\",\"min\":\"min\",\"min_20_characters\":\"20 caractères minimum.\",\"model\":\"Modèle\",\"model_default_inherit\":\"Par défaut (hériter)\",\"model_line\":\"Modèle : {{model}}\",\"model_line_picked\":\"Modèle choisi : {{model}}\",\"model_fork_hint\":\"Le même modèle que la campagne d'origine. Choisis-en un autre pour le changer.\",\"model_withheld_notice\":\"{{requested}} n'est pas proposé pour le moment — cette campagne s'exécute avec {{actual}} à la place. Ton choix de modèle est conservé et sera réutilisé dès qu'il sera proposé.\",\"model_withheld_notice_default\":\"{{requested}} n'est pas proposé pour le moment — cette campagne s'exécute avec le modèle par défaut à la place. Ton choix de modèle est conservé et sera réutilisé dès qu'il sera proposé.\",\"moderate\":\"Modéré\",\"new_campaign\":\"Nouvelle campagne\",\"new_campaign_2\":\"+ Nouvelle campagne\",\"next\":\"Suivant →\",\"no_new_findings_in_the_last_5_cycles\":\"Aucune nouvelle conclusion au cours des 5 derniers cycles.\",\"no_report_yet\":\"Aucun rapport pour le moment.\",\"nudge\":\"Relancer\",\"nudge_direction\":\"Orientation de la relance\",\"nudge_direction_2\":\"Orientation de la relance\",\"one_campaign_at_a_time\":\"Une seule campagne à la fois\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"Une seule campagne à la fois — la recherche gagne en profondeur lorsqu'elle reste concentrée.\",\"parallel_workers\":\"Workers parallèles :\",\"parallel_workers_2\":\"Workers parallèles\",\"pause\":\"Mettre en pause\",\"pick_up_where_this_campaign_left_off\":\"Reprendre là où cette campagne s'est arrêtée.\",\"pre_flight_check\":\"Vérification préalable :\",\"regenerate\":\"Régénérer\",\"regenerate_the_report_updates_the_same_artifact\":\"Régénérer le rapport — met à jour le même artefact sous forme de nouvelle version\",\"regenerating\":\"Régénération…\",\"remove_sub_question\":\"Supprimer la sous-question\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab a pour consigne d'enquêter et de rendre compte, pas d'agir. Ce n'est pas une limite d’autorisations : son worker dispose des outils de ton agent principal et peut écrire des fichiers et exécuter des commandes. Vérifie ces outils avant de lancer une campagne sans surveillance.\",\"research_only\":\"Recherche uniquement.\",\"research_question\":\"Recherche “{{question}}”\",\"research_stalled\":\"Recherche au point mort\",\"research_stopped\":\"Recherche arrêtée\",\"resume\":\"Reprendre\",\"run_autonomous_research_campaigns\":\"Lancer des campagnes de recherche autonomes\",\"run_unattended_skip_clarification_questions\":\"Exécuter sans surveillance (ignorer les questions de clarification)\",\"s_idle\":\"s d'inactivité. ~\",\"scripted\":\"(scripté)\",\"searched_empty\":\"Recherché (vide) :\",\"send\":\"Envoyer\",\"sending\":\"Envoi…\",\"show_less\":\"Afficher moins\",\"show_more\":\"Afficher plus\",\"sources\":\"Sources :\",\"start_campaign\":\"Démarrer la campagne\",\"starting\":\"Démarrage...\",\"state_done\":\"Terminé\",\"state_failed\":\"Échec\",\"state_needs_input\":\"Saisie requise\",\"state_paused\":\"En pause\",\"state_ready\":\"Prêt\",\"state_stalled\":\"Bloqué\",\"state_stopped\":\"Arrêté\",\"state_working\":\"En cours\",\"status\":\"Statut : {{status}}\",\"stop\":\"Arrêter\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"S'arrête au plafond de cycles, lorsque la définition de « terminé » est satisfaite, en cas de stagnation, ou lorsque vous l'arrêtez.\",\"strong\":\"Fort\",\"sub_question\":\"Sous-question {{n}}\",\"sub_questions\":\"Sous-questions\",\"sub_questions_2\":\"sous-questions\",\"sub_questions_guidance_count\":\"Sous-questions et instructions ({{count}})\",\"suggested_from\":\"suggéré depuis\",\"the_agent_is_waiting_for_your_direction\":\"L’agent attend vos instructions.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"L'IA pilote elle-même chaque tour — elle décide quoi examiner, gère les sous-agents et suit les nouvelles pistes issues des conclusions à mesure qu'elles émergent.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"L'IA rédige un script d'orchestration au préalable ; un exécuteur déterministe gère l'exécution des sous-agents tandis que l'IA se contente de planifier, d'enquêter et de synthétiser. Rejouable, avec plafond budgétaire.\",\"the_campaign_stopped_unexpectedly\":\"La campagne s’est arrêtée de façon inattendue.\",\"up_to\":\"Jusqu'à\",\"validating\":\"Validation...\",\"validation_failed_check_your_connection_and_try\":\"Échec de la validation — vérifiez votre connexion et réessayez.\",\"view_report\":\"Voir le rapport\",\"weak\":\"Faible\",\"what_do_you_want_to_research\":\"Que voulez-vous rechercher ?\",\"when_should_the_agent_stop\":\"Quand l'agent doit-il s'arrêter ?\",\"your_answer\":\"Votre réponse\",\"your_answer_2\":\"Votre réponse...\",\"your_guidance\":\"vos indications\"}}}") },
	hi: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"स्वीकारें\",\"answer\":\"उत्तर दें…\",\"answered\":\"उत्तर दिया:\",\"clarifier_answer\":\"स्पष्टीकरण का उत्तर\",\"collapse\":\"समेटें\",\"excluded\":\"बाहर रखा गया\",\"expand\":\"विस्तृत करें\",\"expand_2\":\"विस्तृत करें\",\"included\":\"शामिल\",\"investigate_instead\":\"इसके बजाय जाँच करें\",\"max_depth_add_research_manually_or_prune\":\"अधिकतम गहराई — शोध मैन्युअल रूप से जोड़ें या छाँटें\",\"no_suggestions_add_manually_or_retry\":\"कोई सुझाव नहीं — मैन्युअल रूप से जोड़ें या फिर कोशिश करें\",\"prune\":\"छाँटें\",\"rec\":\"सुझाव:\",\"research_question\":\"शोध प्रश्न\",\"tree_is_getting_large_consider_pruning_branches\":\"ट्री बड़ा होता जा रहा है — जिन शाखाओं पर आगे नहीं बढ़ना है उन्हें छाँटने पर विचार करें।\"},\"manifest\":{\"description\":\"बहु-चक्र रिसर्च अभियान चलाता है जो तुम्हारे हटने के बाद भी काम करते रहते हैं। एक सवाल दो और यह उसे छोटे उप-सवालों के पेड़ में फैला देता है, हर एक की जाँच के लिए एजेंट भेजता है, और नतीजे आते ही पेज पर स्ट्रीम करता है। अभियान खुद चलता रहता है जब तक सवाल का जवाब न मिल जाए या उसे लगे कि प्रगति रुक गई है, और तैयार रिपोर्ट को तुम अपनी Knowledge लाइब्रेरी या शेयर करने योग्य आर्टिफ़ैक्ट में भेज सकते हो।\",\"display_name\":\"Research Lab\",\"use_case_1\":\"ऐसी कई-चक्र वाली जाँच चलाएँ जो व्यापक प्रश्न को विस्तार दे, प्रमाण लगातार दिखाए और दोबारा उपयोग योग्य रिपोर्ट बनाए।\",\"configuration_1\":\"कैंपेन बनाएँ, Agent या Dynamic Workflow मोड चुनें, प्रश्न को विस्तार दें, फिर चक्र, अंतराल, worker और attended या unattended संचालन सेट करें।\",\"highlight_1\":\"एजेंट का समय खर्च करने से पहले एक बड़े सवाल को सीमित दायरे वाले उप-सवालों के पेड़ में फैलाता है\",\"highlight_2\":\"तुम्हारे दो बार देखने के बीच भी अभियान रिसर्च करते रहते हैं, और नतीजे लाइव स्ट्रीम होते हैं\",\"highlight_3\":\"हमेशा लूप में घूमने की जगह पहचान लेता है कि कोई अभियान आगे बढ़ना बंद कर चुका है\",\"highlight_4\":\"अटेंडेड मोड फ़ैसला चाहिए होने पर रुककर तुमसे सवाल पूछता है; अनअटेंडेड सीधे चलता रहता है\",\"highlight_5\":\"अभियान के बीच में ही आगे के सवाल जोड़ो, शुरू से शुरू करने की ज़रूरत नहीं\",\"highlight_6\":\"किसी भी अभियान को डैशबोर्ड से शुरू करो, रोको और फिर चलाओ\",\"highlight_7\":\"तैयार रिपोर्ट को अपनी Knowledge लाइब्रेरी या शेयर करने योग्य आर्टिफ़ैक्ट में एक्सपोर्ट करो\",\"page_label\":\"Research Lab\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"सक्रिय\",\"adaptive\":\"(अनुकूली)\",\"add\":\"उप-प्रश्न जोड़ें\",\"add_guidance_or_a_sub_question\":\"मार्गदर्शन या उप-प्रश्न जोड़ें\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"मार्गदर्शन या उप-प्रश्न जोड़ें… (Enter; नई पंक्ति के लिए Shift+Enter)\",\"add_sub_question_manually\":\"उप-प्रश्न मैन्युअल रूप से जोड़ें\",\"add_sub_question_manually_enter_shift_enter_for\":\"उप-प्रश्न मैन्युअल रूप से जोड़ें (Enter; नई पंक्ति के लिए Shift+Enter)\",\"add_to_knowledge\":\"ज्ञान में जोड़ें\",\"add_your_own_sub_question_or_guidance\":\"अपना उप-प्रश्न या मार्गदर्शन जोड़ें\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"अपना उप-प्रश्न या मार्गदर्शन जोड़ें (Enter; नई लाइन के लिए Shift+Enter)\",\"added_to_knowledge\":\"ज्ञान-भंडार में जोड़ा गया\",\"adding\":\"जोड़ा जा रहा है…\",\"agent\":\"एजेंट\",\"agent_needs_input\":\"एजेंट को इनपुट चाहिए\",\"all_checks_passed\":\"सभी जाँच पास हुईं\",\"already_in_knowledge\":\"पहले से ज्ञान-भंडार में है\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"परिष्कृत करने के लिए चुनौतियों के उत्तर दें, या बस उप-प्रश्न चुनकर फ़ोर्क करें।\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"परिष्कृत करने के लिए स्पष्टीकरण प्रश्नों के उत्तर दें, या बस उप-प्रश्न चुनकर आगे बढ़ें।\",\"answer_resume\":\"उत्तर दें और फिर शुरू करें\",\"back\":\"← वापस\",\"cancel\":\"रद्द करें\",\"challenge_findings\":\"निष्कर्षों को चुनौती दें →\",\"challenge_the_findings_from_question\":\"इनके निष्कर्षों को चुनौती दें: \\\"{{question}}…\\\", फिर एक नए अभियान में फ़ोर्क करें।\",\"challenging\":\"चुनौती दी जा रही है…\",\"continue\":\"जारी रखें\",\"continue_research\":\"शोध जारी रखें\",\"copied\":\"कॉपी हो गया!\",\"copy\":\"कॉपी करें\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"इस सेक्शन का markdown कॉपी करें और चैट या ऑटोपायलट में पेस्ट करें\",\"could_not_generate_challenges_please_try_again\":\"चुनौतियाँ नहीं बनाई जा सकीं। कृपया फिर कोशिश करें।\",\"cycle\":\"चक्र\",\"cycles\":\"चक्र,\",\"cycles_2\":\"चक्र\",\"definition_of_done_optional\":\"पूर्णता की परिभाषा (वैकल्पिक)\",\"delete\":\"हटाएँ\",\"delete_campaign\":\"अभियान हटाएँ?\",\"delete_campaign_button\":\"कैंपेन हटाएं\",\"delete_failed\":\"हटाना विफल रहा। कृपया पुनः प्रयास करें।\",\"delete_this_campaign_and_its_report_this_cannot\":\"इस अभियान और इसकी रिपोर्ट को हटाएँ? इसे पूर्ववत नहीं किया जा सकता।\",\"deleting\":\"हटाया जा रहा है…\",\"done_when\":\"पूर्ण मानें जब:\",\"dynamic_workflow\":\"डायनामिक वर्कफ़्लो\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"डायनामिक वर्कफ़्लो कई सब-एजेंट तक फैल सकता है, और बजट सीमा तक पहुँचने पर रन को तुरंत रोक देता है (बीच का संश्लेषण खो सकता है)। शुरुआत रूढ़िवादी चक्र/वर्कर सीमाओं से करें।\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"उदा. AI कोड समीक्षा में कोई अवरोधक समस्या न मिले और टेस्ट बिल्ड पास हो जाए\",\"emergent\":\"स्वतः उभरा\",\"export_as_artifact\":\"आर्टिफ़ैक्ट के रूप में एक्सपोर्ट करें\",\"exporting\":\"एक्सपोर्ट हो रहा है…\",\"failed_to_add_to_knowledge_library\":\"ज्ञान लाइब्रेरी में जोड़ने में विफल\",\"failed_to_export_as_artifact\":\"आर्टिफ़ैक्ट के रूप में एक्सपोर्ट करने में विफल\",\"failed_to_start_campaign_please_try_again\":\"अभियान शुरू करने में विफल — कृपया फिर कोशिश करें।\",\"findings\":\"निष्कर्ष\",\"findings_count\":\"निष्कर्ष ({{count}})\",\"findings_so_far_are_preserved_below\":\"अब तक के निष्कर्ष नीचे सुरक्षित हैं।\",\"first_cycle_in_progress\":\"पहला चक्र चल रहा है...\",\"focus_on\":\"इस पर ध्यान दें...\",\"fork_challenge\":\"फ़ोर्क करें और चुनौती दें\",\"fork_failed_no_campaign_was_created\":\"फ़ोर्क विफल: कोई अभियान नहीं बना।\",\"fork_failed_please_try_again\":\"फ़ोर्क विफल। कृपया फिर कोशिश करें।\",\"forked\":\"फ़ोर्क किया गया\",\"forked_from\":\"फ़ोर्क का स्रोत:\",\"forking\":\"फ़ोर्क हो रहा है…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"मुक्त-रूप — एक उप-प्रश्न या एक निर्देश जिसका एजेंट अगले चक्र में पालन करे।\",\"give_direction\":\"दिशा दें\",\"goal_met\":\"लक्ष्य पूरा हुआ\",\"goal_not_yet\":\"लक्ष्य: अभी नहीं\",\"grill_me\":\"मुझे परखें →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"ग्रिल उपलब्ध नहीं — नीचे उप-प्रश्न मैन्युअल रूप से जोड़ें।\",\"grilling\":\"परखा जा रहा है…\",\"hide_report\":\"रिपोर्ट छिपाएँ\",\"history\":\"इतिहास\",\"how_do_other_teams_handle_api_rate_limiting\":\"अन्य टीमें API रेट लिमिटिंग को कैसे संभालती हैं?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"सब-एजेंट निष्पादन को कैसे ऑर्केस्ट्रेट किया जाता है। दोनों ही ओपन-एंडेड शोध संभाल लेते हैं। सेटअप के समय एक बार चुनें।\",\"idle_between_cycles\":\"चक्रों के बीच निष्क्रिय समय:\",\"idle_between_cycles_2\":\"चक्रों के बीच निष्क्रिय समय\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"यदि सेट किया गया हो, तो एजेंट हर चक्र में इसके विरुद्ध सत्यापन करता है और शर्त पूरी होने पर काम समाप्त कर देता है।\",\"loading\":\"लोड हो रहा है...\",\"max_cycles\":\"अधिकतम चक्र:\",\"max_cycles_2\":\"अधिकतम चक्र\",\"min\":\"min\",\"min_20_characters\":\"न्यूनतम 20 वर्ण।\",\"model\":\"मॉडल\",\"model_default_inherit\":\"डिफ़ॉल्ट (इनहेरिट)\",\"model_line\":\"मॉडल: {{model}}\",\"model_line_picked\":\"चुना गया मॉडल: {{model}}\",\"model_fork_hint\":\"मूल कैंपेन वाला ही मॉडल। बदलने के लिए कोई दूसरा चुनो।\",\"model_withheld_notice\":\"{{requested}} अभी उपलब्ध नहीं है — यह कैंपेन इसके बजाय {{actual}} पर चल रहा है। तुम्हारी मॉडल पसंद सुरक्षित है और उपलब्ध होते ही फिर से इस्तेमाल होगी।\",\"model_withheld_notice_default\":\"{{requested}} अभी उपलब्ध नहीं है — यह कैंपेन इसके बजाय डिफ़ॉल्ट मॉडल पर चल रहा है। तुम्हारी मॉडल पसंद सुरक्षित है और उपलब्ध होते ही फिर से इस्तेमाल होगी।\",\"moderate\":\"मध्यम\",\"new_campaign\":\"नया अभियान\",\"new_campaign_2\":\"+ नया अभियान\",\"next\":\"आगे →\",\"no_new_findings_in_the_last_5_cycles\":\"पिछले 5 चक्रों में कोई नया निष्कर्ष नहीं।\",\"no_report_yet\":\"अभी कोई रिपोर्ट नहीं।\",\"nudge\":\"नज करें\",\"nudge_direction\":\"नज की दिशा\",\"nudge_direction_2\":\"नज की दिशा\",\"one_campaign_at_a_time\":\"एक बार में एक ही अभियान\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"एक बार में एक ही अभियान — शोध को केंद्रित गहराई से लाभ होता है।\",\"parallel_workers\":\"समानांतर वर्कर:\",\"parallel_workers_2\":\"समानांतर वर्कर\",\"pause\":\"रोकें\",\"pick_up_where_this_campaign_left_off\":\"इस अभियान को वहीं से आगे बढ़ाएँ जहाँ यह छूटा था।\",\"pre_flight_check\":\"प्री-फ़्लाइट जाँच:\",\"regenerate\":\"पुनः बनाएँ\",\"regenerate_the_report_updates_the_same_artifact\":\"रिपोर्ट फिर से बनाएँ — उसी आर्टिफ़ैक्ट को नए वर्शन के रूप में अपडेट करता है\",\"regenerating\":\"पुनः बनाया जा रहा है…\",\"remove_sub_question\":\"उप-प्रश्न हटाएँ\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab को जाँच करने और रिपोर्ट देने का निर्देश दिया जाता है, कार्रवाई करने का नहीं। यह अनुमति की सीमा नहीं है: इसके वर्कर के पास तुम्हारे मुख्य एजेंट के टूल होते हैं और यह फ़ाइलें लिख सकता है और कमांड चला सकता है। किसी अभियान को बिना निगरानी चलाने से पहले उन टूल की समीक्षा करो।\",\"research_only\":\"केवल शोध।\",\"research_question\":\"शोध “{{question}}”\",\"research_stalled\":\"शोध ठहर गया\",\"research_stopped\":\"शोध रोका गया\",\"resume\":\"फिर शुरू करें\",\"run_autonomous_research_campaigns\":\"स्वायत्त शोध अभियान चलाएँ\",\"run_unattended_skip_clarification_questions\":\"बिना निगरानी चलाएँ (स्पष्टीकरण प्रश्न छोड़ें)\",\"s_idle\":\"s निष्क्रिय। ~\",\"scripted\":\"(स्क्रिप्टेड)\",\"searched_empty\":\"खोजा गया (खाली):\",\"send\":\"भेजें\",\"sending\":\"भेजा जा रहा है…\",\"show_less\":\"कम दिखाएँ\",\"show_more\":\"और दिखाएँ\",\"sources\":\"स्रोत:\",\"start_campaign\":\"अभियान शुरू करें\",\"starting\":\"शुरू हो रहा है...\",\"state_done\":\"पूर्ण\",\"state_failed\":\"विफल\",\"state_needs_input\":\"इनपुट चाहिए\",\"state_paused\":\"रोका गया\",\"state_ready\":\"तैयार\",\"state_stalled\":\"अटका हुआ\",\"state_stopped\":\"रुका हुआ\",\"state_working\":\"काम कर रहा है\",\"status\":\"स्थिति: {{status}}\",\"stop\":\"रोकें\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"चक्र सीमा पर, पूर्णता की परिभाषा पूरी होने पर, ठहराव आने पर, या जब आप इसे रोकें — तब रुक जाता है।\",\"strong\":\"मज़बूत\",\"sub_question\":\"उप-प्रश्न {{n}}\",\"sub_questions\":\"उप-प्रश्न\",\"sub_questions_2\":\"उप-प्रश्न\",\"sub_questions_guidance_count\":\"उप-प्रश्न और मार्गदर्शन ({{count}})\",\"suggested_from\":\"सुझाए गए — स्रोत:\",\"the_agent_is_waiting_for_your_direction\":\"एजेंट तुम्हारे निर्देश का इंतज़ार कर रहा है।\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"AI हर राउंड खुद चलाता है — क्या जाँचना है यह तय करता है, सबएजेंट संभालता है, और निष्कर्षों से उभरने वाले नए सूत्रों का पीछा करता है।\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"AI पहले ही एक ऑर्केस्ट्रेशन स्क्रिप्ट लिख देता है; सबएजेंट का निष्पादन एक नियतात्मक रनर संभालता है, जबकि AI केवल योजना बनाता, जाँच करता और संश्लेषण करता है। दोबारा चलाया जा सकता है, बजट-सीमित।\",\"the_campaign_stopped_unexpectedly\":\"अभियान अचानक रुक गया।\",\"up_to\":\"अधिकतम\",\"validating\":\"सत्यापित किया जा रहा है...\",\"validation_failed_check_your_connection_and_try\":\"सत्यापन विफल — अपना कनेक्शन जाँचें और फिर कोशिश करें।\",\"view_report\":\"रिपोर्ट देखें\",\"weak\":\"कमज़ोर\",\"what_do_you_want_to_research\":\"आप किस विषय पर शोध करना चाहते हैं?\",\"when_should_the_agent_stop\":\"एजेंट को कब रुकना चाहिए?\",\"your_answer\":\"आपका उत्तर\",\"your_answer_2\":\"आपका उत्तर...\",\"your_guidance\":\"तुम्हारा मार्गदर्शन\"}}}") },
	it: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"accetta\",\"answer\":\"rispondi…\",\"answered\":\"risposto:\",\"clarifier_answer\":\"Risposta al chiarimento\",\"collapse\":\"Comprimi\",\"excluded\":\"Escluso\",\"expand\":\"espandi\",\"expand_2\":\"Espandi\",\"included\":\"Incluso\",\"investigate_instead\":\"indaga invece\",\"max_depth_add_research_manually_or_prune\":\"profondità massima — aggiungi ricerche manualmente o rimuovine alcune\",\"no_suggestions_add_manually_or_retry\":\"nessun suggerimento — aggiungi manualmente o riprova\",\"prune\":\"Elimina\",\"rec\":\"consigl.:\",\"research_question\":\"Domanda di ricerca\",\"tree_is_getting_large_consider_pruning_branches\":\"L'albero sta diventando grande — considera di rimuovere i rami che non seguirai.\"},\"manifest\":{\"description\":\"Esegue campagne di ricerca a più cicli che continuano a lavorare dopo che ti sei allontanato. Le dai una domanda e la espande in un albero di sotto-domande più circoscritte, manda agenti a indagare su ciascuna e trasmette i risultati alla pagina man mano che arrivano. Una campagna va avanti da sé finché la domanda non ha risposta o finché non nota che i progressi si sono arenati, e il report finito lo puoi passare alla libreria Conoscenza o a un artefatto condivisibile.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"Espande un’unica domanda ampia in un albero circoscritto di sotto-domande prima di spendere tempo degli agenti\",\"highlight_2\":\"Le campagne continuano a cercare tra un tuo controllo e l’altro, con i risultati trasmessi in tempo reale\",\"highlight_3\":\"Si accorge quando una campagna smette di fare progressi, invece di girare in tondo all’infinito\",\"highlight_4\":\"La modalità con supervisione si ferma a chiederti qualcosa quando serve una decisione; senza supervisione va avanti fino in fondo\",\"highlight_5\":\"Aggiungi domande di approfondimento a campagna in corso senza ricominciare\",\"highlight_6\":\"Avvia, metti in pausa e riprendi qualsiasi campagna dalla dashboard\",\"highlight_7\":\"Esporta il report finito nella libreria Conoscenza o in un artefatto condivisibile\",\"page_label\":\"Research Lab\",\"use_case_1\":\"Esegui un'indagine in più cicli che sviluppa una domanda ampia, trasmette le prove e produce un report riutilizzabile.\",\"configuration_1\":\"Crea una campagna, scegli la modalità Agent o Dynamic Workflow, sviluppa la domanda, quindi imposta cicli, intervallo, worker e funzionamento supervisionato o autonomo.\"},\"researchLabPage\":{\"120s\":\"120 s\",\"30s\":\"30 s\",\"60s\":\"60 s\",\"active\":\"ATTIVO\",\"adaptive\":\"(adattivo)\",\"add\":\"Aggiungi\",\"add_guidance_or_a_sub_question\":\"Aggiungi indicazioni o una sotto-domanda\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Aggiungi indicazioni o una sotto-domanda… (Invio; Maiusc+Invio per andare a capo)\",\"add_sub_question_manually\":\"Aggiungi sotto-domanda manualmente\",\"add_sub_question_manually_enter_shift_enter_for\":\"Aggiungi sotto-domanda manualmente (Invio; Maiusc+Invio per andare a capo)\",\"add_to_knowledge\":\"Aggiungi alle conoscenze\",\"add_your_own_sub_question_or_guidance\":\"Aggiungi la tua sotto-domanda o indicazione\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Aggiungi la tua sotto-domanda o indicazione (Invio; Maiusc+Invio per andare a capo)\",\"added_to_knowledge\":\"Aggiunto alle conoscenze\",\"adding\":\"Aggiunta in corso…\",\"agent\":\"Agente\",\"agent_needs_input\":\"L'agente richiede input\",\"all_checks_passed\":\"Tutti i controlli superati\",\"already_in_knowledge\":\"Già nelle conoscenze\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Rispondi alle obiezioni per affinare, oppure scegli semplicemente delle sotto-domande e crea una diramazione.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Rispondi alle domande di chiarimento per affinare, oppure scegli semplicemente delle sotto-domande e procedi.\",\"answer_resume\":\"Rispondi e riprendi\",\"back\":\"← Indietro\",\"cancel\":\"Annulla\",\"challenge_findings\":\"Contesta i risultati →\",\"challenge_the_findings_from_question\":\"Contesta i risultati di \\\"{{question}}…\\\", poi dirama in una nuova campagna.\",\"challenging\":\"Contestazione in corso…\",\"continue\":\"Continua\",\"continue_research\":\"Continua la ricerca\",\"copied\":\"Copiato!\",\"copy\":\"Copia\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Copia il markdown di questa sezione da incollare nella chat o nel pilota automatico\",\"could_not_generate_challenges_please_try_again\":\"Impossibile generare le obiezioni. Riprova.\",\"cycle\":\"Ciclo\",\"cycles\":\"cicli,\",\"cycles_2\":\"cicli\",\"definition_of_done_optional\":\"Definizione di completamento (facoltativo)\",\"delete\":\"Elimina\",\"delete_campaign\":\"Eliminare la campagna?\",\"delete_campaign_button\":\"Elimina campagna\",\"delete_failed\":\"Eliminazione non riuscita. Riprova.\",\"delete_this_campaign_and_its_report_this_cannot\":\"Eliminare questa campagna e il suo report? L'operazione non può essere annullata.\",\"deleting\":\"Eliminazione…\",\"done_when\":\"Completato quando:\",\"dynamic_workflow\":\"Workflow dinamico\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"Il workflow dinamico può diramarsi su molti subagenti e, se raggiunge il limite di budget, interrompe bruscamente l'esecuzione (la sintesi a metà esecuzione potrebbe andare perduta). Inizia con limiti conservativi di cicli/worker.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"ad es. la revisione del codice tramite IA non trova problemi bloccanti e la build di test riesce\",\"emergent\":\"emergente\",\"export_as_artifact\":\"Esporta come artefatto\",\"exporting\":\"Esportazione in corso…\",\"failed_to_add_to_knowledge_library\":\"Impossibile aggiungere alla libreria delle conoscenze\",\"failed_to_export_as_artifact\":\"Impossibile esportare come artefatto\",\"failed_to_start_campaign_please_try_again\":\"Impossibile avviare la campagna — riprova.\",\"findings\":\"risultati\",\"findings_count\":\"Risultati ({{count}})\",\"findings_so_far_are_preserved_below\":\"I risultati ottenuti finora sono conservati qui sotto.\",\"first_cycle_in_progress\":\"Primo ciclo in corso...\",\"focus_on\":\"Concentrati su...\",\"fork_challenge\":\"Dirama e contesta\",\"fork_failed_no_campaign_was_created\":\"Diramazione non riuscita: non è stata creata alcuna campagna.\",\"fork_failed_please_try_again\":\"Diramazione non riuscita. Riprova.\",\"forked\":\"Diramato\",\"forked_from\":\"Diramato da:\",\"forking\":\"Diramazione in corso…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Formato libero — una sotto-domanda o un'istruzione che l'agente dovrà seguire nel ciclo successivo.\",\"give_direction\":\"Dai indicazioni\",\"goal_met\":\"Obiettivo raggiunto\",\"goal_not_yet\":\"Obiettivo: non ancora raggiunto\",\"grill_me\":\"Interrogami →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Interrogazione non disponibile — aggiungi manualmente le sotto-domande qui sotto.\",\"grilling\":\"Interrogazione in corso…\",\"hide_report\":\"Nascondi il report\",\"history\":\"CRONOLOGIA\",\"how_do_other_teams_handle_api_rate_limiting\":\"Come gestiscono gli altri team la limitazione della frequenza delle API?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"Come viene orchestrata l'esecuzione dei subagenti. Entrambe le modalità gestiscono ricerche aperte. Scegli una volta in fase di configurazione.\",\"idle_between_cycles\":\"Inattività tra i cicli:\",\"idle_between_cycles_2\":\"Inattività tra i cicli\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"Se impostato, l'agente verifica questa condizione a ogni ciclo e completa quando è soddisfatta.\",\"loading\":\"Caricamento...\",\"max_cycles\":\"Numero massimo di cicli:\",\"max_cycles_2\":\"Numero massimo di cicli\",\"min\":\"min\",\"min_20_characters\":\"Minimo 20 caratteri.\",\"model\":\"Modello\",\"model_default_inherit\":\"Predefinito (eredita)\",\"model_line\":\"Modello: {{model}}\",\"model_line_picked\":\"Modello scelto: {{model}}\",\"model_fork_hint\":\"Lo stesso modello della campagna originale. Scegline un altro per cambiarlo.\",\"model_withheld_notice\":\"{{requested}} non è disponibile al momento — questa campagna è in esecuzione con {{actual}}. La tua scelta del modello resta salvata e verrà usata di nuovo quando sarà disponibile.\",\"model_withheld_notice_default\":\"{{requested}} non è disponibile al momento — questa campagna è in esecuzione con il modello predefinito. La tua scelta del modello resta salvata e verrà usata di nuovo quando sarà disponibile.\",\"moderate\":\"Moderato\",\"new_campaign\":\"Nuova campagna\",\"new_campaign_2\":\"+ Nuova campagna\",\"next\":\"Avanti →\",\"no_new_findings_in_the_last_5_cycles\":\"Nessun nuovo risultato negli ultimi 5 cicli.\",\"no_report_yet\":\"Ancora nessun report.\",\"nudge\":\"Sollecita\",\"nudge_direction\":\"Direzione del sollecito\",\"nudge_direction_2\":\"Direzione del sollecito\",\"one_campaign_at_a_time\":\"Una campagna alla volta\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"Una campagna alla volta — la ricerca beneficia di una profondità focalizzata.\",\"parallel_workers\":\"Worker paralleli:\",\"parallel_workers_2\":\"Worker paralleli\",\"pause\":\"Metti in pausa\",\"pick_up_where_this_campaign_left_off\":\"Riprendi da dove questa campagna si era interrotta.\",\"pre_flight_check\":\"Controllo preliminare:\",\"regenerate\":\"Rigenera\",\"regenerate_the_report_updates_the_same_artifact\":\"Rigenera il report — aggiorna lo stesso artefatto come nuova versione\",\"regenerating\":\"Rigenerazione in corso…\",\"remove_sub_question\":\"Rimuovi la sotto-domanda\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab ha l'istruzione di indagare e riferire, non di agire. Non è un confine di permessi: il suo worker ha gli strumenti del tuo agente principale e può scrivere file ed eseguire comandi. Controlla quegli strumenti prima di avviare una campagna senza supervisione.\",\"research_only\":\"Solo ricerca.\",\"research_question\":\"Ricerca \\\"{{question}}\\\"\",\"research_stalled\":\"Ricerca in stallo\",\"research_stopped\":\"Ricerca interrotta\",\"resume\":\"Riprendi\",\"run_autonomous_research_campaigns\":\"Esegui campagne di ricerca autonome\",\"run_unattended_skip_clarification_questions\":\"Esegui senza supervisione (salta le domande di chiarimento)\",\"s_idle\":\"s di inattività. ~\",\"scripted\":\"(con script)\",\"searched_empty\":\"Cercato (vuoto):\",\"send\":\"Invia\",\"sending\":\"Invio in corso…\",\"show_less\":\"Mostra meno\",\"show_more\":\"Mostra altro\",\"sources\":\"Origini:\",\"start_campaign\":\"Avvia campagna\",\"starting\":\"Avvio in corso...\",\"state_done\":\"Fatto\",\"state_failed\":\"Non riuscito\",\"state_needs_input\":\"Richiede input\",\"state_paused\":\"In pausa\",\"state_ready\":\"Pronto\",\"state_stalled\":\"In stallo\",\"state_stopped\":\"Arrestato\",\"state_working\":\"Al lavoro\",\"status\":\"Stato: {{status}}\",\"stop\":\"Arresta\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"Si arresta al limite di cicli, quando la definizione di completamento è soddisfatta, in caso di stagnazione o quando lo arresti tu.\",\"strong\":\"Forte\",\"sub_question\":\"Sotto-domanda {{n}}\",\"sub_questions\":\"Sotto-domande\",\"sub_questions_2\":\"sotto-domande\",\"sub_questions_guidance_count\":\"Sotto-domande e indicazioni ({{count}})\",\"suggested_from\":\"suggerito da\",\"the_agent_is_waiting_for_your_direction\":\"L'agente è in attesa delle tue indicazioni.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"L'IA guida da sé ogni round — decide cosa indagare, gestisce i subagenti e segue le nuove piste che emergono dai risultati.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"L'IA scrive in anticipo uno script di orchestrazione; un runner deterministico gestisce l'esecuzione dei subagenti mentre l'IA si limita a pianificare, indagare e sintetizzare. Riproducibile, con limite di budget.\",\"the_campaign_stopped_unexpectedly\":\"La campagna si è interrotta in modo inatteso.\",\"up_to\":\"Fino a\",\"validating\":\"Convalida in corso...\",\"validation_failed_check_your_connection_and_try\":\"Convalida non riuscita — controlla la connessione e riprova.\",\"view_report\":\"Visualizza il report\",\"weak\":\"Debole\",\"what_do_you_want_to_research\":\"Cosa vuoi ricercare?\",\"when_should_the_agent_stop\":\"Quando dovrebbe fermarsi l'agente?\",\"your_answer\":\"La tua risposta\",\"your_answer_2\":\"La tua risposta...\",\"your_guidance\":\"le tue indicazioni\"}}}") },
	ja: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"承認\",\"answer\":\"答え…\",\"answered\":\"回答:\",\"clarifier_answer\":\"明確化の回答\",\"collapse\":\"折りたたむ\",\"excluded\":\"除外\",\"expand\":\"展開\",\"expand_2\":\"展開\",\"included\":\"含まれる\",\"investigate_instead\":\"代わりに調査\",\"max_depth_add_research_manually_or_prune\":\"最大深度 — 手動で調査を追加するか、削除\",\"no_suggestions_add_manually_or_retry\":\"提案なし — 手動で追加するか、再試行\",\"prune\":\"削除\",\"rec\":\"推奨:\",\"research_question\":\"調査質問\",\"tree_is_getting_large_consider_pruning_branches\":\"ツリーが大きくなっています — 追求しないブランチの削除を検討してください。\"},\"manifest\":{\"use_case_1\":\"大まかな問いを展開し、証拠をストリーミングし、再利用可能なレポートを作成する複数サイクルの調査を実行します。\",\"configuration_1\":\"キャンペーンを作成し、Agent または Dynamic Workflow モードを選んで問いを展開した後、サイクル数、間隔、ワーカー数、有人または無人での実行を設定します。\",\"description\":\"席を離れても継続するマルチサイクルの調査キャンペーンを実行します。質問を与えると、より具体的なサブ質問のツリーに展開し、それぞれをエージェントに調査させ、結果が届くたびにページへ表示します。質問に答えが出るか、進展が止まったと判断するまでキャンペーンは自律的に進み、完成したレポートをナレッジライブラリや共有可能なアーティファクトへ渡せます。\",\"display_name\":\"Research Lab\",\"highlight_1\":\"1 つの幅広い質問をスコープされた小質問のツリーに展開してからエージェント時間を使用\",\"highlight_2\":\"キャンペーンはチェックイン間で調査を続け、結果はライブにストリームされます\",\"highlight_3\":\"進捗が止まったことを検知し、延々とループするのを防ぎます\",\"highlight_4\":\"対話モードでは判断が必要なときに一時停止して質問します。無人モードでは中断せずに続行します\",\"highlight_5\":\"最初からやり直さずに、キャンペーンの途中でフォローアップの質問を追加\",\"highlight_6\":\"ダッシュボードから任意のキャンペーンを開始、一時停止、再開\",\"highlight_7\":\"完成したレポートをナレッジライブラリまたは共有可能な成果物にエクスポート\",\"page_label\":\"Research Lab\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"アクティブ\",\"adaptive\":\"(適応型)\",\"add\":\"追加\",\"add_guidance_or_a_sub_question\":\"ガイダンスまたは小質問を追加\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"ガイダンスまたは小質問を追加… (Enter; 改行は Shift+Enter)\",\"add_sub_question_manually\":\"サブ質問を手動で追加\",\"add_sub_question_manually_enter_shift_enter_for\":\"サブ質問を手動で追加（Enter キー、改行は Shift+Enter キー）\",\"add_to_knowledge\":\"ナレッジに追加\",\"add_your_own_sub_question_or_guidance\":\"サブ質問またはガイダンスを追加\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"サブ質問またはガイダンスを追加（Enter キー、改行は Shift+Enter キー）\",\"added_to_knowledge\":\"ナレッジに追加されました\",\"adding\":\"追加中…\",\"agent\":\"エージェント\",\"agent_needs_input\":\"エージェントが入力を待機しています\",\"all_checks_passed\":\"すべてのチェックに合格しました\",\"already_in_knowledge\":\"既にナレッジに含まれています\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"チャレンジに答えて改善するか、サブ質問を選んでフォークする\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"質問を答えて改善するか、サブ質問を選んで進める\",\"answer_resume\":\"回答して再開\",\"back\":\"← 戻る\",\"cancel\":\"キャンセル\",\"challenge_findings\":\"結果に異議を唱える →\",\"challenge_the_findings_from_question\":\"「{{question}}…」の調査結果に異議を唱えて、新しいキャンペーンにフォークします。\",\"challenging\":\"異議を唱え中…\",\"continue\":\"続行\",\"continue_research\":\"調査を続行\",\"copied\":\"コピーしました！\",\"copy\":\"コピー\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"このセクションのマークダウンをコピーしてチャットまたはオートパイロットに貼り付け\",\"could_not_generate_challenges_please_try_again\":\"チャレンジを生成できませんでした。もう一度お試しください。\",\"cycle\":\"サイクル\",\"cycles\":\"サイクル、\",\"cycles_2\":\"サイクル\",\"definition_of_done_optional\":\"完了の定義（オプション）\",\"delete\":\"削除\",\"delete_campaign\":\"キャンペーンを削除しますか？\",\"delete_campaign_button\":\"キャンペーンを削除\",\"delete_failed\":\"削除に失敗しました。もう一度お試しください。\",\"delete_this_campaign_and_its_report_this_cannot\":\"このキャンペーンとそのレポートを削除しますか？この操作は取り消せません。\",\"deleting\":\"削除中…\",\"done_when\":\"完了条件：\",\"dynamic_workflow\":\"ダイナミックワークフロー\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"ダイナミックワークフローは多くのサブエージェントにファンアウトでき、予算キャップに達すると実行が停止します（実行中の統合が失われる可能性があります）。保守的なサイクル/ワーカー制限から始めてください。\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"例：AI コードレビューがブロッキングイシューを検出せず、テストビルドが成功する\",\"emergent\":\"新興\",\"export_as_artifact\":\"アーティファクトとしてエクスポート\",\"exporting\":\"エクスポート中…\",\"failed_to_add_to_knowledge_library\":\"ナレッジライブラリへの追加に失敗しました\",\"failed_to_export_as_artifact\":\"アーティファクトとしてのエクスポートに失敗しました\",\"failed_to_start_campaign_please_try_again\":\"キャンペーンの開始に失敗しました。もう一度お試しください。\",\"findings\":\"調査結果\",\"findings_count\":\"調査結果（{{count}}）\",\"findings_so_far_are_preserved_below\":\"これまでの調査結果は以下に保存されます。\",\"first_cycle_in_progress\":\"最初のサイクルが進行中です…\",\"focus_on\":\"フォーカス…\",\"fork_challenge\":\"フォーク & 異議を唱える\",\"fork_failed_no_campaign_was_created\":\"フォーク失敗：キャンペーンが作成されませんでした。\",\"fork_failed_please_try_again\":\"フォークに失敗しました。もう一度お試しください。\",\"forked\":\"フォーク済み\",\"forked_from\":\"フォーク元：\",\"forking\":\"フォーク中…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"フリーフォーム — エージェントが次のサイクルで従うべきサブ質問または指示。\",\"give_direction\":\"方向を指示\",\"goal_met\":\"目標達成\",\"goal_not_yet\":\"目標：未達成\",\"grill_me\":\"詳しく聞く →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"詳しく聞くは利用できません — 以下でサブ質問を手動で追加してください。\",\"grilling\":\"詳しく聞く中…\",\"hide_report\":\"レポートを非表示\",\"history\":\"履歴\",\"how_do_other_teams_handle_api_rate_limiting\":\"他のチームはどのように API レート制限に対処していますか？\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"サブエージェントの実行がどのようにオーケストレーションされるか。どちらもオープンエンドの調査を扱います。セットアップ時に一度選択します。\",\"idle_between_cycles\":\"サイクル間のアイドル時間：\",\"idle_between_cycles_2\":\"サイクル間のアイドル時間\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"設定されている場合、エージェントは各サイクルでこれに対して検証を行い、条件を満たしたら完了します。\",\"loading\":\"読み込み中…\",\"max_cycles\":\"最大サイクル：\",\"max_cycles_2\":\"最大サイクル\",\"min\":\"分\",\"min_20_characters\":\"最小 20 文字。\",\"model\":\"モデル\",\"model_default_inherit\":\"デフォルト（継承）\",\"model_line\":\"モデル：{{model}}\",\"model_line_picked\":\"選択したモデル：{{model}}\",\"model_fork_hint\":\"元のキャンペーンと同じモデルです。変更するには別のモデルを選んでください。\",\"model_withheld_notice\":\"{{requested}} は現在提供されていません — このキャンペーンは代わりに {{actual}} で実行されています。モデルの選択は保持され、再び提供されると自動的に使用されます。\",\"model_withheld_notice_default\":\"{{requested}} は現在提供されていません — このキャンペーンは代わりにデフォルトモデルで実行されています。モデルの選択は保持され、再び提供されると自動的に使用されます。\",\"moderate\":\"標準\",\"new_campaign\":\"新しいキャンペーン\",\"new_campaign_2\":\"+ 新しいキャンペーン\",\"next\":\"次へ →\",\"no_new_findings_in_the_last_5_cycles\":\"直近 5 サイクルで新しい調査結果はありません。\",\"no_report_yet\":\"レポートはまだありません。\",\"nudge\":\"促す\",\"nudge_direction\":\"促す方向\",\"nudge_direction_2\":\"促す方向\",\"one_campaign_at_a_time\":\"一度に 1 つのキャンペーン\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"一度に 1 つのキャンペーン — 調査は集中的な深さから恩恵を受けます。\",\"parallel_workers\":\"並列ワーカー：\",\"parallel_workers_2\":\"並列ワーカー\",\"pause\":\"一時停止\",\"pick_up_where_this_campaign_left_off\":\"このキャンペーンが中断したところから再開します。\",\"pre_flight_check\":\"事前チェック：\",\"regenerate\":\"再生成\",\"regenerate_the_report_updates_the_same_artifact\":\"レポートを再生成 — 同じアーティファクトを新しいバージョンとして更新\",\"regenerating\":\"再生成中…\",\"remove_sub_question\":\"サブ質問を削除\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab には調査とレポートを行い、操作はしないよう指示されています。これは権限の境界ではありません。ワーカーはメインエージェントと同じツールを持ち、ファイルの書き込みやコマンドの実行ができます。無人でキャンペーンを実行する前に、それらのツールを確認してください。\",\"research_only\":\"調査のみ。\",\"research_question\":\"「{{question}}」を調査\",\"research_stalled\":\"調査が停滞\",\"research_stopped\":\"調査を停止しました\",\"resume\":\"再開\",\"run_autonomous_research_campaigns\":\"自動調査キャンペーンを実行\",\"run_unattended_skip_clarification_questions\":\"無人で実行（確認質問をスキップ）\",\"s_idle\":\"秒アイドル中。~\",\"scripted\":\"（スクリプト化）\",\"searched_empty\":\"検索（空）：\",\"send\":\"送信\",\"sending\":\"送信中…\",\"show_less\":\"表示を減らす\",\"show_more\":\"もっと表示\",\"sources\":\"ソース：\",\"start_campaign\":\"キャンペーンを開始\",\"starting\":\"開始中…\",\"state_done\":\"完了\",\"state_failed\":\"失敗\",\"state_needs_input\":\"入力が必要\",\"state_paused\":\"一時停止中\",\"state_ready\":\"準備完了\",\"state_stalled\":\"停滞中\",\"state_stopped\":\"停止\",\"state_working\":\"実行中\",\"status\":\"ステータス：{{status}}\",\"stop\":\"停止\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"サイクル上限に達するか、完了の定義が満たされるか、停滞時またはあなたが停止した時に停止します。\",\"strong\":\"強い\",\"sub_question\":\"サブ質問 {{n}}\",\"sub_questions\":\"サブ質問\",\"sub_questions_2\":\"サブ質問\",\"sub_questions_guidance_count\":\"サブ質問とガイダンス（{{count}}）\",\"suggested_from\":\"提案元\",\"the_agent_is_waiting_for_your_direction\":\"エージェントはあなたの指示を待機しています。\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"AI がすべてのラウンドを自動的に駆動します — 調査内容を決定し、サブエージェントを管理し、調査結果から新しい手がかりが得られたらそれを追跡します。\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"AI は事前にオーケストレーションスクリプトを作成します。決定論的なランナーがサブエージェントの実行を管理している間、AI は計画、調査、統合のみを行います。再生可能、予算制限付き。\",\"the_campaign_stopped_unexpectedly\":\"キャンペーンが予期せず停止しました。\",\"up_to\":\"最大\",\"validating\":\"検証中…\",\"validation_failed_check_your_connection_and_try\":\"検証に失敗しました。接続を確認してもう一度お試しください。\",\"view_report\":\"レポートを表示\",\"weak\":\"弱い\",\"what_do_you_want_to_research\":\"何を調査しますか？\",\"when_should_the_agent_stop\":\"エージェントはいつ停止すべきですか？\",\"your_answer\":\"あなたの回答\",\"your_answer_2\":\"あなたの回答…\",\"your_guidance\":\"あなたのガイダンス\"}}}") },
	ko: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"수락\",\"answer\":\"답변…\",\"answered\":\"답변됨:\",\"clarifier_answer\":\"확인 질문 답변\",\"collapse\":\"접기\",\"excluded\":\"제외됨\",\"expand\":\"펼치기\",\"expand_2\":\"펼치기\",\"included\":\"포함됨\",\"investigate_instead\":\"대신 조사하기\",\"max_depth_add_research_manually_or_prune\":\"최대 깊이 — 조사를 직접 추가하거나 가지치기하세요\",\"no_suggestions_add_manually_or_retry\":\"제안 없음 — 직접 추가하거나 다시 시도하세요\",\"prune\":\"가지치기\",\"rec\":\"권장:\",\"research_question\":\"조사 질문\",\"tree_is_getting_large_consider_pruning_branches\":\"트리가 커지고 있습니다 — 진행하지 않을 가지는 정리하는 것을 고려하세요.\"},\"manifest\":{\"use_case_1\":\"넓은 질문을 확장하고 증거를 스트리밍하며 재사용 가능한 보고서를 만드는 다중 주기 조사를 실행합니다.\",\"configuration_1\":\"캠페인을 만들고 Agent 또는 Dynamic Workflow 모드를 선택해 질문을 확장한 다음, 주기 수, 간격, 작업 에이전트 수, 사용자 참여 또는 무인 실행을 설정하세요.\",\"description\":\"자리를 비운 뒤에도 계속 진행되는 다중 사이클 조사 캠페인을 실행합니다. 질문을 주면 더 좁은 하위 질문의 트리로 확장하고, 각각을 조사할 에이전트를 보내며, 결과가 도착하는 대로 페이지에 스트리밍합니다. 캠페인은 질문에 답이 나오거나 진전이 멈춘 것을 감지할 때까지 스스로 진행되며, 완성된 보고서는 지식 라이브러리나 공유 가능한 아티팩트로 넘길 수 있습니다.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"에이전트 시간을 쓰기 전에 하나의 넓은 질문을 범위가 정해진 하위 질문 트리로 확장합니다\",\"highlight_2\":\"캠페인은 확인하지 않는 동안에도 조사를 이어 가고, 결과는 실시간으로 스트리밍됩니다\",\"highlight_3\":\"끝없이 반복하는 대신 캠페인의 진전이 멈춘 시점을 감지합니다\",\"highlight_4\":\"대화 모드는 판단이 필요할 때 멈추고 질문하며, 무인 모드는 중단 없이 진행합니다\",\"highlight_5\":\"처음부터 다시 시작하지 않고 캠페인 도중에 후속 질문을 추가합니다\",\"highlight_6\":\"대시보드에서 어떤 캠페인이든 시작·일시중지·재개\",\"highlight_7\":\"완성된 보고서를 지식 라이브러리나 공유 가능한 아티팩트로 내보냅니다\",\"page_label\":\"Research Lab\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"활성\",\"adaptive\":\"(적응형)\",\"add\":\"추가\",\"add_guidance_or_a_sub_question\":\"지침 또는 하위 질문 추가\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"지침 또는 하위 질문 추가… (Enter, 줄바꿈은 Shift+Enter)\",\"add_sub_question_manually\":\"하위 질문 직접 추가\",\"add_sub_question_manually_enter_shift_enter_for\":\"하위 질문 직접 추가 (Enter, 줄바꿈은 Shift+Enter)\",\"add_to_knowledge\":\"지식에 추가\",\"add_your_own_sub_question_or_guidance\":\"직접 하위 질문이나 지침 추가\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"직접 하위 질문이나 지침 추가 (Enter, 줄바꿈은 Shift+Enter)\",\"added_to_knowledge\":\"지식에 추가됨\",\"adding\":\"추가 중…\",\"agent\":\"에이전트\",\"agent_needs_input\":\"에이전트에 입력이 필요합니다\",\"all_checks_passed\":\"모든 검사를 통과했습니다\",\"already_in_knowledge\":\"이미 지식에 있음\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"반론에 답해 다듬거나, 하위 질문만 골라 포크하세요.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"확인 질문에 답해 다듬거나, 하위 질문만 골라 진행하세요.\",\"answer_resume\":\"답변 후 재개\",\"back\":\"← 뒤로\",\"cancel\":\"취소\",\"challenge_findings\":\"결과에 반론 제기 →\",\"challenge_the_findings_from_question\":\"‘{{question}}…’의 조사 결과에 반론을 제기한 뒤 새 캠페인으로 포크합니다.\",\"challenging\":\"반론 제기 중…\",\"continue\":\"계속\",\"continue_research\":\"조사 계속하기\",\"copied\":\"복사했습니다!\",\"copy\":\"복사\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"이 섹션의 Markdown을 복사해 채팅이나 오토파일럿에 붙여넣기\",\"could_not_generate_challenges_please_try_again\":\"반론을 생성하지 못했습니다. 다시 시도하세요.\",\"cycle\":\"사이클\",\"cycles\":\"사이클,\",\"cycles_2\":\"사이클\",\"definition_of_done_optional\":\"완료 정의 (선택 사항)\",\"delete\":\"삭제\",\"delete_campaign\":\"캠페인을 삭제하시겠습니까?\",\"delete_campaign_button\":\"캠페인 삭제\",\"delete_failed\":\"삭제에 실패했습니다. 다시 시도해 주세요.\",\"delete_this_campaign_and_its_report_this_cannot\":\"이 캠페인과 보고서를 삭제하시겠습니까? 되돌릴 수 없습니다.\",\"deleting\":\"삭제 중…\",\"done_when\":\"완료 조건:\",\"dynamic_workflow\":\"동적 워크플로\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"동적 워크플로는 많은 서브에이전트로 확산될 수 있으며, 예산 상한에 도달하면 실행이 즉시 중단됩니다 (진행 중이던 종합 결과가 사라질 수 있습니다). 사이클·워커 제한을 보수적으로 잡고 시작하세요.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"예: AI 코드 리뷰에서 차단 이슈가 없고 테스트 빌드가 통과\",\"emergent\":\"창발적\",\"export_as_artifact\":\"아티팩트로 내보내기\",\"exporting\":\"내보내는 중…\",\"failed_to_add_to_knowledge_library\":\"지식 라이브러리에 추가하지 못했습니다\",\"failed_to_export_as_artifact\":\"아티팩트로 내보내지 못했습니다\",\"failed_to_start_campaign_please_try_again\":\"캠페인을 시작하지 못했습니다 — 다시 시도하세요.\",\"findings\":\"조사 결과\",\"findings_count\":\"조사 결과 ({{count}})\",\"findings_so_far_are_preserved_below\":\"지금까지의 조사 결과는 아래에 보존됩니다.\",\"first_cycle_in_progress\":\"첫 사이클이 진행 중입니다…\",\"focus_on\":\"집중할 부분…\",\"fork_challenge\":\"포크 후 반론 제기\",\"fork_failed_no_campaign_was_created\":\"포크 실패: 캠페인이 생성되지 않았습니다.\",\"fork_failed_please_try_again\":\"포크에 실패했습니다. 다시 시도하세요.\",\"forked\":\"포크됨\",\"forked_from\":\"포크 원본:\",\"forking\":\"포크 중…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"자유 형식 — 에이전트가 다음 사이클에 따라야 할 하위 질문이나 지시입니다.\",\"give_direction\":\"방향 제시\",\"goal_met\":\"목표 달성\",\"goal_not_yet\":\"목표: 미달성\",\"grill_me\":\"심층 질문 받기 →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"심층 질문을 사용할 수 없습니다 — 아래에서 하위 질문을 직접 추가하세요.\",\"grilling\":\"심층 질문 생성 중…\",\"hide_report\":\"보고서 숨기기\",\"history\":\"기록\",\"how_do_other_teams_handle_api_rate_limiting\":\"다른 팀은 API 속도 제한을 어떻게 처리하나요?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"서브에이전트 실행을 어떻게 오케스트레이션할지 정합니다. 둘 다 열린 조사를 처리할 수 있습니다. 설정 시 한 번만 선택합니다.\",\"idle_between_cycles\":\"사이클 간 대기:\",\"idle_between_cycles_2\":\"사이클 간 대기\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"설정하면 에이전트가 매 사이클마다 이 기준으로 검증하고 충족되면 완료합니다.\",\"loading\":\"불러오는 중…\",\"max_cycles\":\"최대 사이클:\",\"max_cycles_2\":\"최대 사이클\",\"min\":\"분\",\"min_20_characters\":\"최소 20자.\",\"model\":\"모델\",\"model_default_inherit\":\"기본값(상속)\",\"model_line\":\"모델: {{model}}\",\"model_line_picked\":\"선택한 모델: {{model}}\",\"model_fork_hint\":\"원래 캠페인과 같은 모델입니다. 변경하려면 다른 모델을 선택하세요.\",\"model_withheld_notice\":\"{{requested}}은(는) 현재 제공되지 않습니다 — 이 캠페인은 대신 {{actual}}(으)로 실행 중입니다. 모델 선택은 유지되며 다시 제공되면 자동으로 사용됩니다.\",\"model_withheld_notice_default\":\"{{requested}}은(는) 현재 제공되지 않습니다 — 이 캠페인은 대신 기본 모델로 실행 중입니다. 모델 선택은 유지되며 다시 제공되면 자동으로 사용됩니다.\",\"moderate\":\"보통\",\"new_campaign\":\"새 캠페인\",\"new_campaign_2\":\"+ 새 캠페인\",\"next\":\"다음 →\",\"no_new_findings_in_the_last_5_cycles\":\"최근 5 사이클 동안 새로운 조사 결과가 없습니다.\",\"no_report_yet\":\"아직 보고서가 없습니다.\",\"nudge\":\"방향 조정\",\"nudge_direction\":\"조정할 방향\",\"nudge_direction_2\":\"조정할 방향\",\"one_campaign_at_a_time\":\"한 번에 한 캠페인\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"한 번에 한 캠페인 — 조사는 집중된 깊이에서 더 좋은 결과를 냅니다.\",\"parallel_workers\":\"병렬 워커:\",\"parallel_workers_2\":\"병렬 워커\",\"pause\":\"일시중지\",\"pick_up_where_this_campaign_left_off\":\"이 캠페인이 중단된 지점부터 이어서 진행합니다.\",\"pre_flight_check\":\"사전 점검:\",\"regenerate\":\"다시 생성\",\"regenerate_the_report_updates_the_same_artifact\":\"보고서 다시 생성 — 같은 아티팩트를 새 버전으로 업데이트합니다\",\"regenerating\":\"다시 생성 중…\",\"remove_sub_question\":\"하위 질문 제거\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab은 조사하고 보고하도록 지시받을 뿐, 실행하지 않도록 되어 있습니다. 이는 권한 경계가 아닙니다. 워커는 메인 에이전트의 도구를 그대로 가지며 파일을 쓰고 명령을 실행할 수 있습니다. 무인으로 캠페인을 실행하기 전에 해당 도구를 검토하세요.\",\"research_only\":\"조사 전용.\",\"research_question\":\"‘{{question}}’ 조사\",\"research_stalled\":\"조사 정체\",\"research_stopped\":\"조사가 중지되었습니다\",\"resume\":\"재개\",\"run_autonomous_research_campaigns\":\"자율 조사 캠페인 실행\",\"run_unattended_skip_clarification_questions\":\"무인으로 실행 (확인 질문 건너뛰기)\",\"s_idle\":\"초 대기. ~\",\"scripted\":\"(스크립트형)\",\"searched_empty\":\"검색함 (결과 없음):\",\"send\":\"보내기\",\"sending\":\"보내는 중…\",\"show_less\":\"간략히 보기\",\"show_more\":\"더 보기\",\"sources\":\"출처:\",\"start_campaign\":\"캠페인 시작\",\"starting\":\"시작 중…\",\"state_done\":\"완료\",\"state_failed\":\"실패\",\"state_needs_input\":\"입력 필요\",\"state_paused\":\"일시중지됨\",\"state_ready\":\"준비됨\",\"state_stalled\":\"정체됨\",\"state_stopped\":\"중지됨\",\"state_working\":\"작업 중\",\"status\":\"상태: {{status}}\",\"stop\":\"중지\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"사이클 상한에 도달하거나, 완료 정의가 충족되거나, 정체되거나, 사용자가 중지하면 멈춥니다.\",\"strong\":\"강함\",\"sub_question\":\"하위 질문 {{n}}\",\"sub_questions\":\"하위 질문\",\"sub_questions_2\":\"하위 질문\",\"sub_questions_guidance_count\":\"하위 질문 및 지침 ({{count}})\",\"suggested_from\":\"제안 출처\",\"the_agent_is_waiting_for_your_direction\":\"에이전트가 지시를 기다리고 있습니다.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"AI가 모든 라운드를 직접 주도합니다 — 무엇을 조사할지 정하고, 서브에이전트를 관리하며, 조사 결과에서 새 단서가 나오면 따라갑니다.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"AI가 미리 오케스트레이션 스크립트를 작성하고, 결정론적 러너가 서브에이전트 실행을 관리하는 동안 AI는 계획·조사·종합만 수행합니다. 재실행이 가능하고 예산 상한이 적용됩니다.\",\"the_campaign_stopped_unexpectedly\":\"캠페인이 예기치 않게 중지되었습니다.\",\"up_to\":\"최대\",\"validating\":\"검증 중…\",\"validation_failed_check_your_connection_and_try\":\"검증에 실패했습니다 — 연결을 확인하고 다시 시도하세요.\",\"view_report\":\"보고서 보기\",\"weak\":\"약함\",\"what_do_you_want_to_research\":\"무엇을 조사할까요?\",\"when_should_the_agent_stop\":\"에이전트는 언제 멈춰야 하나요?\",\"your_answer\":\"답변\",\"your_answer_2\":\"답변…\",\"your_guidance\":\"지침\"}}}") },
	pt: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"aceitar\",\"answer\":\"responder…\",\"answered\":\"respondido:\",\"clarifier_answer\":\"Resposta de esclarecimento\",\"collapse\":\"Recolher\",\"excluded\":\"Excluída\",\"expand\":\"expandir\",\"expand_2\":\"Expandir\",\"included\":\"Incluída\",\"investigate_instead\":\"investigar em vez disso\",\"max_depth_add_research_manually_or_prune\":\"profundidade máxima — adicione pesquisa manualmente ou pode ramos\",\"no_suggestions_add_manually_or_retry\":\"nenhuma sugestão — adicione manualmente ou tente novamente\",\"prune\":\"Podar\",\"rec\":\"rec:\",\"research_question\":\"Pergunta de pesquisa\",\"tree_is_getting_large_consider_pruning_branches\":\"A árvore está ficando grande — considere podar os ramos que você não vai seguir.\"},\"manifest\":{\"description\":\"Executa campanhas de pesquisa de vários ciclos que continuam trabalhando depois que você sai. Dê uma pergunta e ele a desdobra em uma árvore de subperguntas mais específicas, envia agentes para investigar cada uma e transmite as descobertas para a página conforme elas chegam. Uma campanha se conduz sozinha até a pergunta ser respondida ou até perceber que o progresso parou, e você pode enviar o relatório final para a sua biblioteca de Conhecimento ou para um artefato compartilhável.\",\"display_name\":\"Research Lab\",\"highlight_1\":\"Desdobra uma pergunta ampla em uma árvore delimitada de subperguntas antes de gastar tempo de agente\",\"highlight_2\":\"As campanhas continuam pesquisando entre as suas visitas, com as descobertas transmitidas ao vivo\",\"highlight_3\":\"Percebe quando uma campanha para de progredir, em vez de repetir para sempre\",\"highlight_4\":\"O modo supervisionado pausa para lhe fazer uma pergunta quando precisa de uma decisão; sem supervisão, a execução segue direto\",\"highlight_5\":\"Acrescente perguntas de acompanhamento no meio da campanha, sem começar de novo\",\"highlight_6\":\"Inicie, pause e retome qualquer campanha pelo painel\",\"highlight_7\":\"Exporte o relatório final para a sua biblioteca de Conhecimento ou para um artefato compartilhável\",\"page_label\":\"Research Lab\",\"use_case_1\":\"Execute uma investigação em vários ciclos que expande uma pergunta ampla, transmite evidências e produz um relatório reutilizável.\",\"configuration_1\":\"Crie uma campanha, escolha o modo Agent ou Dynamic Workflow, expanda a pergunta e defina ciclos, intervalo, workers e operação supervisionada ou autônoma.\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"ATIVA\",\"adaptive\":\"(adaptativo)\",\"add\":\"Adicionar\",\"add_guidance_or_a_sub_question\":\"Adicionar orientação ou uma subpergunta\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Adicionar orientação ou uma subpergunta… (Enter; Shift+Enter para nova linha)\",\"add_sub_question_manually\":\"Adicionar subpergunta manualmente\",\"add_sub_question_manually_enter_shift_enter_for\":\"Adicionar subpergunta manualmente (Enter; Shift+Enter para nova linha)\",\"add_to_knowledge\":\"Adicionar ao Conhecimento\",\"add_your_own_sub_question_or_guidance\":\"Adicione sua própria subpergunta ou orientação\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Adicione sua própria subpergunta ou orientação (Enter; Shift+Enter para nova linha)\",\"added_to_knowledge\":\"Adicionado ao Conhecimento\",\"adding\":\"Adicionando…\",\"agent\":\"Agente\",\"agent_needs_input\":\"O agente precisa de uma resposta\",\"all_checks_passed\":\"Todas as verificações passaram\",\"already_in_knowledge\":\"Já está no Conhecimento\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Responda aos questionamentos para refinar, ou apenas escolha subperguntas e bifurque.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Responda aos esclarecimentos para refinar, ou apenas escolha subperguntas e siga.\",\"answer_resume\":\"Responder e retomar\",\"back\":\"← Voltar\",\"cancel\":\"Cancelar\",\"challenge_findings\":\"Questionar as descobertas →\",\"challenge_the_findings_from_question\":\"Questionar as descobertas de \\\"{{question}}…\\\", depois bifurque em uma nova campanha.\",\"challenging\":\"Questionando…\",\"continue\":\"Continuar\",\"continue_research\":\"Continuar a pesquisa\",\"copied\":\"Copiado!\",\"copy\":\"Copiar\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Copiar o markdown desta seção para colar no chat ou no autopilot\",\"could_not_generate_challenges_please_try_again\":\"Não foi possível gerar questionamentos. Tente novamente.\",\"cycle\":\"Ciclo\",\"cycles\":\"ciclos,\",\"cycles_2\":\"ciclos\",\"definition_of_done_optional\":\"Definição de Pronto (opcional)\",\"delete\":\"Excluir\",\"delete_campaign\":\"Excluir campanha?\",\"delete_campaign_button\":\"Excluir campanha\",\"delete_failed\":\"Falha ao excluir. Tente novamente.\",\"delete_this_campaign_and_its_report_this_cannot\":\"Excluir esta campanha e o relatório dela? Isso não pode ser desfeito.\",\"deleting\":\"Excluindo…\",\"done_when\":\"Pronto quando:\",\"dynamic_workflow\":\"Fluxo de trabalho dinâmico\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"O Fluxo de trabalho dinâmico pode se ramificar em muitos subagentes, e o limite de orçamento interrompe a execução na hora se for atingido (a síntese em andamento pode ser perdida). Comece com limites conservadores de ciclos/workers.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"ex.: a revisão de código por IA não encontra problemas bloqueantes e a build de teste passa\",\"emergent\":\"emergente\",\"export_as_artifact\":\"Exportar como artefato\",\"exporting\":\"Exportando…\",\"failed_to_add_to_knowledge_library\":\"Falha ao adicionar à Biblioteca de Conhecimento\",\"failed_to_export_as_artifact\":\"Falha ao exportar como artefato\",\"failed_to_start_campaign_please_try_again\":\"Falha ao iniciar a campanha — tente novamente.\",\"findings\":\"descobertas\",\"findings_count\":\"Descobertas ({{count}})\",\"findings_so_far_are_preserved_below\":\"As descobertas até agora estão preservadas abaixo.\",\"first_cycle_in_progress\":\"Primeiro ciclo em andamento...\",\"focus_on\":\"Focar em...\",\"fork_challenge\":\"Bifurcar e questionar\",\"fork_failed_no_campaign_was_created\":\"Falha na bifurcação: nenhuma campanha foi criada.\",\"fork_failed_please_try_again\":\"Falha na bifurcação. Tente novamente.\",\"forked\":\"Bifurcada\",\"forked_from\":\"Bifurcada de:\",\"forking\":\"Bifurcando…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Formato livre — uma subpergunta ou uma instrução que o agente deve seguir no próximo ciclo.\",\"give_direction\":\"Dar direção\",\"goal_met\":\"Objetivo alcançado\",\"goal_not_yet\":\"Meta: ainda não\",\"grill_me\":\"Me interrogue →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Grill indisponível — adicione subperguntas manualmente abaixo.\",\"grilling\":\"Interrogando…\",\"hide_report\":\"Ocultar relatório\",\"history\":\"HISTÓRICO\",\"how_do_other_teams_handle_api_rate_limiting\":\"Como outras equipes lidam com limitação de taxa de API?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"Como a execução dos subagentes é orquestrada. Ambos lidam com pesquisa aberta. Escolha uma vez na configuração.\",\"idle_between_cycles\":\"Espera entre ciclos:\",\"idle_between_cycles_2\":\"Espera entre ciclos\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"Se definido, o agente verifica isso em cada ciclo e conclui quando for atendido.\",\"loading\":\"Carregando...\",\"max_cycles\":\"Ciclos máx.:\",\"max_cycles_2\":\"Ciclos máx.\",\"min\":\"min\",\"min_20_characters\":\"Mín. 20 caracteres.\",\"model\":\"Modelo\",\"model_default_inherit\":\"Padrão (herdar)\",\"model_line\":\"Modelo: {{model}}\",\"model_line_picked\":\"Modelo escolhido: {{model}}\",\"model_fork_hint\":\"O mesmo modelo da campanha original. Escolha outro para mudar.\",\"model_withheld_notice\":\"{{requested}} não está disponível no momento — esta campanha está sendo executada com {{actual}}. Sua escolha de modelo é mantida e será usada novamente quando estiver disponível.\",\"model_withheld_notice_default\":\"{{requested}} não está disponível no momento — esta campanha está sendo executada com o modelo padrão. Sua escolha de modelo é mantida e será usada novamente quando estiver disponível.\",\"moderate\":\"Moderado\",\"new_campaign\":\"Nova campanha\",\"new_campaign_2\":\"+ Nova campanha\",\"next\":\"Avançar →\",\"no_new_findings_in_the_last_5_cycles\":\"Nenhuma descoberta nova nos últimos 5 ciclos.\",\"no_report_yet\":\"Ainda não há relatório.\",\"nudge\":\"Orientar\",\"nudge_direction\":\"Orientar a direção\",\"nudge_direction_2\":\"Orientar a direção\",\"one_campaign_at_a_time\":\"Uma campanha por vez\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"Uma campanha por vez — a pesquisa se beneficia de profundidade focada.\",\"parallel_workers\":\"Workers paralelos:\",\"parallel_workers_2\":\"Workers paralelos\",\"pause\":\"Pausar\",\"pick_up_where_this_campaign_left_off\":\"Continue de onde esta campanha parou.\",\"pre_flight_check\":\"Verificação prévia:\",\"regenerate\":\"Gerar novamente\",\"regenerate_the_report_updates_the_same_artifact\":\"Gerar o relatório novamente — atualiza o mesmo artefato como uma nova versão\",\"regenerating\":\"Gerando novamente…\",\"remove_sub_question\":\"Remover subpergunta\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab é instruído a investigar e relatar, não a agir. Isso não é um limite de permissões: o worker dele tem as ferramentas do seu agente principal e pode gravar arquivos e executar comandos. Revise essas ferramentas antes de executar uma campanha sem supervisão.\",\"research_only\":\"Somente pesquisa.\",\"research_question\":\"Pesquisar “{{question}}”\",\"research_stalled\":\"Pesquisa estagnada\",\"research_stopped\":\"Pesquisa interrompida\",\"resume\":\"Retomar\",\"run_autonomous_research_campaigns\":\"Execute campanhas de pesquisa autônomas\",\"run_unattended_skip_clarification_questions\":\"Executar sem supervisão (ignorar perguntas de esclarecimento)\",\"s_idle\":\"s de espera. ~\",\"scripted\":\"(com script)\",\"searched_empty\":\"Pesquisado (vazio):\",\"send\":\"Enviar\",\"sending\":\"Enviando…\",\"show_less\":\"Mostrar menos\",\"show_more\":\"Mostrar mais\",\"sources\":\"Fontes:\",\"start_campaign\":\"Iniciar campanha\",\"starting\":\"Iniciando...\",\"state_done\":\"Concluído\",\"state_failed\":\"Falhou\",\"state_needs_input\":\"Entrada necessária\",\"state_paused\":\"Pausado\",\"state_ready\":\"Pronto\",\"state_stalled\":\"Travado\",\"state_stopped\":\"Parado\",\"state_working\":\"Trabalhando\",\"status\":\"Status: {{status}}\",\"stop\":\"Parar\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"Para no limite de ciclos, quando a Definição de Pronto é atendida, em caso de estagnação ou quando você clicar em Parar.\",\"strong\":\"Forte\",\"sub_question\":\"Subpergunta {{n}}\",\"sub_questions\":\"Subperguntas\",\"sub_questions_2\":\"subperguntas\",\"sub_questions_guidance_count\":\"Subperguntas e orientações ({{count}})\",\"suggested_from\":\"sugerido a partir de\",\"the_agent_is_waiting_for_your_direction\":\"O agente está esperando o seu direcionamento.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"A IA conduz cada rodada por conta própria — decidindo o que investigar, gerenciando subagentes e seguindo novas pistas das descobertas conforme elas surgem.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"A IA escreve um script de orquestração no início; um executor determinístico gerencia a execução dos subagentes enquanto a IA apenas planeja, investiga e sintetiza. Reproduzível e com orçamento limitado.\",\"the_campaign_stopped_unexpectedly\":\"A campanha parou inesperadamente.\",\"up_to\":\"Até\",\"validating\":\"Validando...\",\"validation_failed_check_your_connection_and_try\":\"A validação falhou — verifique sua conexão e tente novamente.\",\"view_report\":\"Ver relatório\",\"weak\":\"Fraco\",\"what_do_you_want_to_research\":\"O que você quer pesquisar?\",\"when_should_the_agent_stop\":\"Quando o agente deve parar?\",\"your_answer\":\"Sua resposta\",\"your_answer_2\":\"Sua resposta...\",\"your_guidance\":\"seu direcionamento\"}}}") },
	ru: { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"принять\",\"answer\":\"ответить…\",\"answered\":\"ответ:\",\"clarifier_answer\":\"Ответ на уточнение\",\"collapse\":\"Свернуть\",\"excluded\":\"Исключено\",\"expand\":\"развернуть\",\"expand_2\":\"Развернуть\",\"included\":\"Включено\",\"investigate_instead\":\"исследовать вместо этого\",\"max_depth_add_research_manually_or_prune\":\"максимальная глубина — добавьте исследование вручную или обрежьте ветки\",\"no_suggestions_add_manually_or_retry\":\"нет предложений — добавьте вручную или повторите\",\"prune\":\"Обрезать\",\"rec\":\"рек.:\",\"research_question\":\"Исследовательский вопрос\",\"tree_is_getting_large_consider_pruning_branches\":\"Дерево становится большим — обрежьте ветки, которые не будете развивать.\"},\"manifest\":{\"description\":\"Ведёт многоцикловые исследовательские кампании, которые продолжают работать, даже когда тебя нет за компьютером. Задай вопрос — и кампания развернёт его в дерево более узких подвопросов, отправит агентов изучить каждый и будет передавать выводы на страницу по мере их появления. Кампания идёт сама, пока вопрос не решён или пока не станет ясно, что продвижение остановилось; готовый отчёт можно отправить в библиотеку знаний или в артефакт, которым легко поделиться.\",\"display_name\":\"Research Lab\",\"use_case_1\":\"Проводите многоцикловое исследование, которое развивает широкий вопрос, передаёт доказательства по мере работы и создаёт повторно используемый отчёт.\",\"configuration_1\":\"Создайте кампанию, выберите режим Agent или Dynamic Workflow, разверните вопрос, затем задайте число циклов, интервал, количество исполнителей и режим с участием пользователя или без него.\",\"highlight_1\":\"Разворачивает один широкий вопрос в очерченное дерево подвопросов, прежде чем тратить время агентов\",\"highlight_2\":\"Кампании продолжают исследование между твоими заходами, а выводы приходят в реальном времени\",\"highlight_3\":\"Замечает, что кампания перестала продвигаться, вместо бесконечного цикла\",\"highlight_4\":\"Режим с присмотром останавливается и задаёт вопрос, когда нужно решение; без присмотра запуск проходит целиком\",\"highlight_5\":\"Добавляй уточняющие вопросы посреди кампании, не начиная заново\",\"highlight_6\":\"Запуск, пауза и продолжение любой кампании прямо на панели\",\"highlight_7\":\"Экспорт готового отчёта в библиотеку знаний или в артефакт, которым можно поделиться\",\"page_label\":\"Research Lab\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"АКТИВНО\",\"adaptive\":\"(адаптивный)\",\"add\":\"Добавить\",\"add_guidance_or_a_sub_question\":\"Добавьте указание или подвопрос\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"Добавьте указание или подвопрос… (Enter; Shift+Enter — новая строка)\",\"add_sub_question_manually\":\"Добавить подвопрос вручную\",\"add_sub_question_manually_enter_shift_enter_for\":\"Добавить подвопрос вручную (Enter; Shift+Enter — новая строка)\",\"add_to_knowledge\":\"Добавить в «Знания»\",\"add_your_own_sub_question_or_guidance\":\"Добавьте свой подвопрос или указание\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"Добавьте свой подвопрос или указание (Enter; Shift+Enter — новая строка)\",\"added_to_knowledge\":\"Добавлено в Знания\",\"adding\":\"Добавление...\",\"agent\":\"Агент\",\"agent_needs_input\":\"Агенту нужен ввод\",\"all_checks_passed\":\"Все проверки пройдены\",\"already_in_knowledge\":\"Уже в Знаниях\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"Ответьте на возражения, чтобы уточнить, или просто выберите подвопросы и создайте ответвление.\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"Ответьте на уточнения, чтобы уточнить запрос, или просто выберите подвопросы и продолжайте.\",\"answer_resume\":\"Ответить и продолжить\",\"back\":\"← Назад\",\"cancel\":\"Отмена\",\"challenge_findings\":\"Оспорить выводы →\",\"challenge_the_findings_from_question\":\"Оспорить выводы из «{{question}}…», затем создайте ответвление в новую кампанию.\",\"challenging\":\"Оспаривание...\",\"continue\":\"Продолжить\",\"continue_research\":\"Продолжить исследование\",\"copied\":\"Скопировано!\",\"copy\":\"Копировать\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"Скопировать markdown этого раздела для вставки в чат или автопилот\",\"could_not_generate_challenges_please_try_again\":\"Не удалось сформировать возражения. Попробуй ещё раз.\",\"cycle\":\"Цикл\",\"cycles\":\"циклов,\",\"cycles_2\":\"циклов\",\"definition_of_done_optional\":\"Критерий готовности (необязательно)\",\"delete\":\"Удалить\",\"delete_campaign\":\"Удалить кампанию?\",\"delete_campaign_button\":\"Удалить кампанию\",\"delete_failed\":\"Не удалось удалить. Повторите попытку.\",\"delete_this_campaign_and_its_report_this_cannot\":\"Удалить эту кампанию и её отчёт? Это действие нельзя отменить.\",\"deleting\":\"Удаление…\",\"done_when\":\"Готово, когда:\",\"dynamic_workflow\":\"Динамический рабочий процесс\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"Динамический рабочий процесс может развернуть много подагентов, а при достижении лимита бюджета запуск жёстко останавливается (промежуточный синтез может быть потерян). Начните с осторожных лимитов циклов и воркеров.\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"например: ИИ-проверка кода не находит блокирующих проблем и тестовая сборка проходит\",\"emergent\":\"возникший\",\"export_as_artifact\":\"Экспортировать как артефакт\",\"exporting\":\"Экспорт...\",\"failed_to_add_to_knowledge_library\":\"Не удалось добавить в библиотеку знаний\",\"failed_to_export_as_artifact\":\"Не удалось экспортировать как артефакт\",\"failed_to_start_campaign_please_try_again\":\"Не удалось запустить кампанию — попробуй ещё раз.\",\"findings\":\"выводов\",\"findings_count\":\"Выводы ({{count}})\",\"findings_so_far_are_preserved_below\":\"Полученные выводы сохранены ниже.\",\"first_cycle_in_progress\":\"Выполняется первый цикл...\",\"focus_on\":\"Сосредоточиться на...\",\"fork_challenge\":\"Ответвить и оспорить\",\"fork_failed_no_campaign_was_created\":\"Не удалось ответвить: кампания не создана.\",\"fork_failed_please_try_again\":\"Не удалось ответвить. Попробуй ещё раз.\",\"forked\":\"Ответвлено\",\"forked_from\":\"Ответвлено от:\",\"forking\":\"Ответвление...\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"Свободная форма — подвопрос или указание, которому агент последует в следующем цикле.\",\"give_direction\":\"Задать направление\",\"goal_met\":\"Цель достигнута\",\"goal_not_yet\":\"Цель: пока нет\",\"grill_me\":\"Опроси меня →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"Опрос недоступен — добавьте подвопросы вручную ниже.\",\"grilling\":\"Опрос...\",\"hide_report\":\"Скрыть отчёт\",\"history\":\"ИСТОРИЯ\",\"how_do_other_teams_handle_api_rate_limiting\":\"Как другие команды решают ограничение частоты запросов к API?\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"Как организуется выполнение подагентов. Оба варианта подходят для открытого исследования. Выбирается один раз при настройке.\",\"idle_between_cycles\":\"Пауза между циклами:\",\"idle_between_cycles_2\":\"Пауза между циклами\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"Если задано, агент проверяет это каждый цикл и завершает работу при выполнении.\",\"loading\":\"Загрузка...\",\"max_cycles\":\"Макс. циклов:\",\"max_cycles_2\":\"Макс. циклов\",\"min\":\"мин\",\"min_20_characters\":\"Минимум 20 символов.\",\"model\":\"Модель\",\"model_default_inherit\":\"По умолчанию (наследовать)\",\"model_line\":\"Модель: {{model}}\",\"model_line_picked\":\"Выбранная модель: {{model}}\",\"model_fork_hint\":\"Та же модель, что у исходной кампании. Выбери другую, чтобы изменить.\",\"model_withheld_notice\":\"{{requested}} сейчас недоступна — эта кампания работает на {{actual}}. Твой выбор модели сохранён и снова будет использован, когда она станет доступна.\",\"model_withheld_notice_default\":\"{{requested}} сейчас недоступна — эта кампания работает на модели по умолчанию. Твой выбор модели сохранён и снова будет использован, когда она станет доступна.\",\"moderate\":\"Умеренная\",\"new_campaign\":\"Новая кампания\",\"new_campaign_2\":\"+ Новая кампания\",\"next\":\"Далее →\",\"no_new_findings_in_the_last_5_cycles\":\"Нет новых выводов за последние 5 циклов.\",\"no_report_yet\":\"Отчёта пока нет.\",\"nudge\":\"Подтолкнуть\",\"nudge_direction\":\"Направление подсказки\",\"nudge_direction_2\":\"Направление подсказки\",\"one_campaign_at_a_time\":\"По одной кампании за раз\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"По одной кампании за раз — исследование выигрывает от сосредоточенной глубины.\",\"parallel_workers\":\"Параллельные воркеры:\",\"parallel_workers_2\":\"Параллельные воркеры\",\"pause\":\"Пауза\",\"pick_up_where_this_campaign_left_off\":\"Продолжить с того места, где кампания остановилась.\",\"pre_flight_check\":\"Предстартовая проверка:\",\"regenerate\":\"Пересоздать\",\"regenerate_the_report_updates_the_same_artifact\":\"Пересоздать отчёт — обновляет тот же артефакт как новую версию\",\"regenerating\":\"Пересоздание...\",\"remove_sub_question\":\"Удалить подвопрос\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab получает указание изучать и составлять отчёты, а не действовать. Это не граница разрешений: её исполнитель имеет инструменты твоего основного агента и может записывать файлы и выполнять команды. Проверь эти инструменты, прежде чем запускать кампанию без присмотра.\",\"research_only\":\"Только исследование.\",\"research_question\":\"Исследовать «{{question}}»\",\"research_stalled\":\"Исследование застопорилось\",\"research_stopped\":\"Исследование остановлено\",\"resume\":\"Возобновить\",\"run_autonomous_research_campaigns\":\"Запускайте автономные исследовательские кампании\",\"run_unattended_skip_clarification_questions\":\"Запустить без присмотра (пропустить уточняющие вопросы)\",\"s_idle\":\"с простоя. ~\",\"scripted\":\"(по скрипту)\",\"searched_empty\":\"Поиск (пусто):\",\"send\":\"Отправить\",\"sending\":\"Отправка...\",\"show_less\":\"Свернуть\",\"show_more\":\"Показать больше\",\"sources\":\"Источники:\",\"start_campaign\":\"Запустить кампанию\",\"starting\":\"Запуск...\",\"state_done\":\"Завершено\",\"state_failed\":\"Ошибка\",\"state_needs_input\":\"Нужен ввод\",\"state_paused\":\"Приостановлено\",\"state_ready\":\"Готово\",\"state_stalled\":\"Застопорилось\",\"state_stopped\":\"Остановлено\",\"state_working\":\"В работе\",\"status\":\"Статус: {{status}}\",\"stop\":\"Остановить\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"Останавливается по лимиту циклов, при выполнении критерия готовности, при застое или когда вы нажмёте «Остановить».\",\"strong\":\"Сильная\",\"sub_question\":\"Подвопрос {{n}}\",\"sub_questions\":\"Подвопросы\",\"sub_questions_2\":\"подвопросов\",\"sub_questions_guidance_count\":\"Подвопросы и указания ({{count}})\",\"suggested_from\":\"предложено из\",\"the_agent_is_waiting_for_your_direction\":\"Агент ждёт твоих указаний.\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"ИИ сам ведёт каждый раунд — решает, что исследовать, управляет подагентами и следует новым зацепкам из выводов по мере их появления.\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"ИИ заранее пишет скрипт оркестрации; детерминированный исполнитель управляет запуском подагентов, а ИИ только планирует, исследует и обобщает. Воспроизводимо, с лимитом бюджета.\",\"the_campaign_stopped_unexpectedly\":\"Кампания неожиданно остановилась.\",\"up_to\":\"До\",\"validating\":\"Проверка...\",\"validation_failed_check_your_connection_and_try\":\"Проверка не пройдена — проверь соединение и попробуй ещё раз.\",\"view_report\":\"Открыть отчёт\",\"weak\":\"Слабая\",\"what_do_you_want_to_research\":\"Что вы хотите исследовать?\",\"when_should_the_agent_stop\":\"Когда агент должен остановиться?\",\"your_answer\":\"Ваш ответ\",\"your_answer_2\":\"Ваш ответ...\",\"your_guidance\":\"твои указания\"}}}") },
	"zh-CN": { apps: /* @__PURE__ */ JSON.parse("{\"autoResearch\":{\"grillTree\":{\"accept\":\"采纳\",\"answer\":\"回答…\",\"answered\":\"已回答：\",\"clarifier_answer\":\"澄清回答\",\"collapse\":\"折叠\",\"excluded\":\"已排除\",\"expand\":\"展开\",\"expand_2\":\"展开\",\"included\":\"已包含\",\"investigate_instead\":\"改为调查\",\"max_depth_add_research_manually_or_prune\":\"已达最大深度 — 手动添加研究或修剪\",\"no_suggestions_add_manually_or_retry\":\"无建议 — 手动添加或重试\",\"prune\":\"修剪\",\"rec\":\"建议：\",\"research_question\":\"研究问题\",\"tree_is_getting_large_consider_pruning_branches\":\"树正变得庞大 — 考虑修剪你不会深入的分支。\"},\"manifest\":{\"use_case_1\":\"运行多轮调查，展开宽泛问题、流式汇总证据，并生成可复用的报告。\",\"configuration_1\":\"创建研究任务，选择 Agent 或 Dynamic Workflow 模式，展开问题，然后设置轮数、间隔、工作代理数，以及有人值守或无人值守运行。\",\"description\":\"运行多轮研究任务，你离开之后它仍会继续。给它一个问题，它会拆成一棵更细的子问题树，派代理逐个调查，并把发现实时推送到页面。研究任务会自行推进，直到问题有了答案或它发现进展停滞；完成的报告可以存入知识库，也可以导出为可分享的产物。\",\"display_name\":\"Research Lab\",\"highlight_1\":\"先把宽泛的问题展开成范围明确的子问题树，然后才动用代理\",\"highlight_2\":\"在你两次查看之间，研究任务照常推进，发现实时推送\",\"highlight_3\":\"会察觉研究任务不再有进展，而不是无限循环下去\",\"highlight_4\":\"有人值守模式在需要决策时会暂停向你提问；无人值守则一路跑完\",\"highlight_5\":\"研究任务进行中也能追加问题，无需从头开始\",\"highlight_6\":\"在仪表板上启动、暂停和恢复任意研究任务\",\"highlight_7\":\"把完成的报告导出到知识库，或导出为可分享的产物\",\"page_label\":\"Research Lab\"},\"researchLabPage\":{\"120s\":\"120s\",\"30s\":\"30s\",\"60s\":\"60s\",\"active\":\"进行中\",\"adaptive\":\"（自适应）\",\"add\":\"添加\",\"add_guidance_or_a_sub_question\":\"添加指引或子问题\",\"add_guidance_or_a_sub_question_enter_shift_enter\":\"添加指引或子问题…（Enter 发送；Shift+Enter 换行）\",\"add_sub_question_manually\":\"手动添加子问题\",\"add_sub_question_manually_enter_shift_enter_for\":\"手动添加子问题（Enter 发送；Shift+Enter 换行）\",\"add_to_knowledge\":\"添加到知识库\",\"add_your_own_sub_question_or_guidance\":\"添加你自己的子问题或指引\",\"add_your_own_sub_question_or_guidance_enter_shif\":\"添加你自己的子问题或指引（Enter 发送；Shift+Enter 换行）\",\"added_to_knowledge\":\"已加入知识库\",\"adding\":\"正在添加…\",\"agent\":\"代理\",\"agent_needs_input\":\"代理需要输入\",\"all_checks_passed\":\"所有检查已通过\",\"already_in_knowledge\":\"已在知识库中\",\"answer_challenges_to_refine_or_just_pick_sub_que\":\"回答质疑以细化，或直接选择子问题并复刻。\",\"answer_clarifiers_to_refine_or_just_pick_sub_que\":\"回答澄清问题以细化，或直接选择子问题继续。\",\"answer_resume\":\"回答并恢复\",\"back\":\"← 返回\",\"cancel\":\"取消\",\"challenge_findings\":\"质疑发现 →\",\"challenge_the_findings_from_question\":\"质疑来自“{{question}}…”，然后分叉为新战役。\",\"challenging\":\"正在质疑…\",\"continue\":\"继续\",\"continue_research\":\"继续研究\",\"copied\":\"已复制！\",\"copy\":\"复制\",\"copy_this_section_s_markdown_to_paste_into_chat\":\"复制本节 Markdown，以粘贴到聊天或自动驾驶中\",\"could_not_generate_challenges_please_try_again\":\"无法生成质疑。请重试。\",\"cycle\":\"轮次\",\"cycles\":\"轮，\",\"cycles_2\":\"轮\",\"definition_of_done_optional\":\"完成标准（可选）\",\"delete\":\"删除\",\"delete_campaign\":\"删除活动？\",\"delete_campaign_button\":\"删除研究活动\",\"delete_failed\":\"删除失败。请重试。\",\"delete_this_campaign_and_its_report_this_cannot\":\"删除此活动及其报告？此操作无法撤销。\",\"deleting\":\"正在删除…\",\"done_when\":\"完成条件：\",\"dynamic_workflow\":\"动态工作流\",\"dynamic_workflow_can_fan_out_to_many_sub_agents\":\"动态工作流可扇出大量子代理，一旦触及预算上限就会硬性终止运行（中途的综合结果可能丢失）。请先设置保守的轮次/并发上限。\",\"e_g_ai_code_review_finds_no_blocking_issues_and\":\"例如：AI 代码审查未发现阻塞问题，且测试构建通过\",\"emergent\":\"涌现\",\"export_as_artifact\":\"导出为产物\",\"exporting\":\"正在导出…\",\"failed_to_add_to_knowledge_library\":\"添加到知识库失败\",\"failed_to_export_as_artifact\":\"导出为产物失败\",\"failed_to_start_campaign_please_try_again\":\"启动战役失败 — 请重试。\",\"findings\":\"条结论\",\"findings_count\":\"结论（{{count}}）\",\"findings_so_far_are_preserved_below\":\"目前的结论保留在下方。\",\"first_cycle_in_progress\":\"第一轮进行中…\",\"focus_on\":\"聚焦于…\",\"fork_challenge\":\"分叉并质询\",\"fork_failed_no_campaign_was_created\":\"分叉失败：未创建战役。\",\"fork_failed_please_try_again\":\"分叉失败。请重试。\",\"forked\":\"已分叉\",\"forked_from\":\"分叉自：\",\"forking\":\"正在分叉…\",\"free_form_a_sub_question_or_an_instruction_the_a\":\"自由格式 — 一个子问题，或代理下一轮应遵循的指令。\",\"give_direction\":\"给出方向\",\"goal_met\":\"已达成目标\",\"goal_not_yet\":\"目标：尚未达成\",\"grill_me\":\"质询我 →\",\"grill_unavailable_add_sub_questions_manually_bel\":\"质询不可用 — 请在下方手动添加子问题。\",\"grilling\":\"正在质询…\",\"hide_report\":\"隐藏报告\",\"history\":\"历史\",\"how_do_other_teams_handle_api_rate_limiting\":\"其他团队如何处理 API 限流？\",\"how_sub_agent_execution_is_orchestrated_both_han\":\"子代理执行的编排方式。两者都能处理开放式研究。设置时选定一次。\",\"idle_between_cycles\":\"轮次间空闲：\",\"idle_between_cycles_2\":\"轮次间空闲\",\"if_set_the_agent_verifies_against_this_each_cycl\":\"设置后，代理每轮都会据此校验，达成即完成。\",\"loading\":\"正在加载…\",\"max_cycles\":\"最大轮次：\",\"max_cycles_2\":\"最大轮次\",\"min\":\"分钟\",\"min_20_characters\":\"至少 20 个字符。\",\"model\":\"模型\",\"model_default_inherit\":\"默认（继承）\",\"model_line\":\"模型：{{model}}\",\"model_line_picked\":\"所选模型：{{model}}\",\"model_fork_hint\":\"与原活动相同的模型。如需更改，请选择其他模型。\",\"model_withheld_notice\":\"{{requested}} 当前不可用 — 此活动改为在 {{actual}} 上运行。你的模型选择会被保留，再次可用时将自动使用。\",\"model_withheld_notice_default\":\"{{requested}} 当前不可用 — 此活动改为在默认模型上运行。你的模型选择会被保留，再次可用时将自动使用。\",\"moderate\":\"中等\",\"new_campaign\":\"新建战役\",\"new_campaign_2\":\"+ 新建战役\",\"next\":\"下一步 →\",\"no_new_findings_in_the_last_5_cycles\":\"最近 5 轮没有新结论。\",\"no_report_yet\":\"暂无报告。\",\"nudge\":\"推动\",\"nudge_direction\":\"推动方向\",\"nudge_direction_2\":\"推动方向\",\"one_campaign_at_a_time\":\"每次仅进行一个战役\",\"one_campaign_at_a_time_research_benefits_from_fo\":\"每次仅进行一个战役 — 研究更适合专注深挖。\",\"parallel_workers\":\"并行工作者：\",\"parallel_workers_2\":\"并行工作者\",\"pause\":\"暂停\",\"pick_up_where_this_campaign_left_off\":\"从此战役中断处继续。\",\"pre_flight_check\":\"启动前检查：\",\"regenerate\":\"重新生成\",\"regenerate_the_report_updates_the_same_artifact\":\"重新生成报告 — 以新版本更新同一产物\",\"regenerating\":\"正在重新生成…\",\"remove_sub_question\":\"移除子问题\",\"research_lab\":\"Research Lab\",\"research_lab_investigates_and_reports_it_never_t\":\"Research Lab 被指示只做调查和汇报，不动手执行。这不是权限边界：它的 worker 拥有你主代理的全部工具，可以写文件、执行命令。无人值守运行活动前，请先检查这些工具。\",\"research_only\":\"仅研究。\",\"research_question\":\"研究“{{question}}”\",\"research_stalled\":\"研究已停滞\",\"research_stopped\":\"研究已停止\",\"resume\":\"恢复\",\"run_autonomous_research_campaigns\":\"运行自主研究战役\",\"run_unattended_skip_clarification_questions\":\"无人值守运行（跳过澄清问题）\",\"s_idle\":\"秒空闲。~\",\"scripted\":\"（脚本化）\",\"searched_empty\":\"已搜索（无结果）：\",\"send\":\"发送\",\"sending\":\"正在发送…\",\"show_less\":\"收起\",\"show_more\":\"展开更多\",\"sources\":\"引用来源：\",\"start_campaign\":\"启动战役\",\"starting\":\"正在启动…\",\"state_done\":\"已完成\",\"state_failed\":\"失败\",\"state_needs_input\":\"需要输入\",\"state_paused\":\"已暂停\",\"state_ready\":\"就绪\",\"state_stalled\":\"已停滞\",\"state_stopped\":\"已停止\",\"state_working\":\"进行中\",\"status\":\"状态：{{status}}\",\"stop\":\"停止\",\"stops_at_the_cycle_cap_when_the_definition_of_do\":\"在达到轮次上限、满足完成标准、进展停滞或你手动停止时结束。\",\"strong\":\"强\",\"sub_question\":\"子问题 {{n}}\",\"sub_questions\":\"子问题\",\"sub_questions_2\":\"个子问题\",\"sub_questions_guidance_count\":\"子问题与指引（{{count}}）\",\"suggested_from\":\"建议来自\",\"the_agent_is_waiting_for_your_direction\":\"代理正在等待你的指示。\",\"the_ai_drives_every_round_itself_deciding_what_t\":\"AI 自行驱动每一轮 — 决定调查什么、管理子代理，并随着结论浮现跟进新线索。\",\"the_ai_writes_an_orchestration_script_up_front_a\":\"AI 先写好一份编排脚本；由确定性运行器管理子代理执行，AI 只负责规划、调查和综合。可重放，有预算上限。\",\"the_campaign_stopped_unexpectedly\":\"战役意外停止。\",\"up_to\":\"最多\",\"validating\":\"校验中…\",\"validation_failed_check_your_connection_and_try\":\"验证失败 — 检查网络连接后重试。\",\"view_report\":\"查看报告\",\"weak\":\"弱\",\"what_do_you_want_to_research\":\"你想研究什么？\",\"when_should_the_agent_stop\":\"代理应在何时停止？\",\"your_answer\":\"你的回答\",\"your_answer_2\":\"你的回答…\",\"your_guidance\":\"你的指导\"}}}") }
};
var own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function lookup(catalog, key) {
	let node = catalog;
	for (const part of key.split(".")) {
		if (node === void 0 || typeof node === "string" || !own(node, part)) return void 0;
		node = node[part];
	}
	return typeof node === "string" ? node : void 0;
}
/** The catalogs to try for `locale`, most specific first, always ending in English. */
function localeChain(locale) {
	const chain = [];
	const add = (candidate) => {
		if (own(CATALOGS, candidate) && !chain.includes(candidate)) chain.push(candidate);
	};
	add(locale);
	add(locale.split("-")[0]);
	add("en");
	return chain;
}
function currentLocale() {
	try {
		const locale = activeLocale();
		return typeof locale === "string" && locale ? locale : "en";
	} catch {
		return "en";
	}
}
var PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
function pluralForm(locale, count) {
	try {
		return new Intl.PluralRules(locale).select(count);
	} catch {
		return count === 1 ? "one" : "other";
	}
}
function t(key, vars) {
	const count = vars && typeof vars.count === "number" ? vars.count : void 0;
	for (const locale of localeChain(currentLocale())) {
		const catalog = CATALOGS[locale];
		let text;
		if (count !== void 0) text = lookup(catalog, `${key}_${pluralForm(locale, count)}`) ?? lookup(catalog, `${key}_other`);
		text = text ?? lookup(catalog, key);
		if (text !== void 0) return text.replace(PLACEHOLDER, (whole, name) => vars && own(vars, name) ? String(vars[name]) : whole);
	}
	return key;
}
/** The dashboard's name for this helper, so the ported call sites read unchanged. */
var i18nT = t;
// src/GrillTree.tsx
var MAX_DEPTH = 4;
var SOFT_LIMIT = 25;
function AutoGrow({ value, onChange, onSubmit, placeholder, className = "", ariaLabel }) {
	const ref = useRef(null);
	const ime = useImeGuard();
	useEffect(() => {
		const el = ref.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		}
	}, [value]);
	return /* @__PURE__ */ jsx("textarea", {
		ref,
		rows: 1,
		"aria-label": ariaLabel,
		placeholder,
		className: `resize-none overflow-hidden ${className}`,
		value,
		onChange: (e) => onChange(e.target.value),
		...ime.bindComposition(),
		onKeyDown: (e) => {
			if (onSubmit && e.key === "Enter" && !e.shiftKey && ime.claimEnter(e)) onSubmit(value);
		}
	});
}
function AnswerBox({ initial, onSubmit }) {
	const [val, setVal] = useState(initial || "");
	return /* @__PURE__ */ jsx(AutoGrow, {
		value: val,
		onChange: setVal,
		onSubmit,
		placeholder: i18nT("apps.autoResearch.grillTree.answer"),
		ariaLabel: i18nT("apps.autoResearch.grillTree.clarifier_answer"),
		className: "flex-1 min-w-[18rem] bg-bg border border-border rounded px-1.5 py-0.5 text-text align-top"
	});
}
function GrillTree({ tree, dispatch, onExpand }) {
	const [expandingIds, setExpandingIds] = useState(/* @__PURE__ */ new Set());
	const [collapsed, setCollapsed] = useState(/* @__PURE__ */ new Set());
	const [tried, setTried] = useState(/* @__PURE__ */ new Set());
	const live = tree.filter((n) => n.status !== "pruned");
	const childrenOf = (id) => live.filter((n) => n.parent === id);
	const toggleCollapse = (id) => setCollapsed((s) => {
		const n = new Set(s);
		if (n.has(id)) n.delete(id);
		else n.add(id);
		return n;
	});
	async function expand(id) {
		setExpandingIds((s) => new Set(s).add(id));
		try {
			await onExpand(id);
		} finally {
			setExpandingIds((s) => {
				const next = new Set(s);
				next.delete(id);
				return next;
			});
			setTried((s) => new Set(s).add(id));
		}
	}
	function whyPath(id) {
		const byId = new Map(tree.map((n) => [n.id, n]));
		const parts = [];
		let cur = byId.get(id);
		while (cur && cur.parent) {
			const p = byId.get(cur.parent);
			if (p && p.kind === "clarifier" && p.answer) parts.unshift(`${p.text} → ${p.answer}`);
			cur = p;
		}
		return parts.length ? parts.join("  /  ") : "top-level question";
	}
	function renderNode(node, depth) {
		const kids = childrenOf(node.id);
		const isCollapsed = collapsed.has(node.id);
		const atMaxDepth = nodeDepth(tree, node.id) >= MAX_DEPTH;
		const spinning = expandingIds.has(node.id);
		const noResults = tried.has(node.id) && kids.length === 0 && !spinning;
		return /* @__PURE__ */ jsxs("div", {
			style: { marginLeft: depth ? 16 : 0 },
			className: depth ? "border-l border-dashed border-border pl-3 mt-1.5" : "mt-1.5",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-start gap-1.5 text-sm",
					children: [
						kids.length > 0 ? /* @__PURE__ */ jsx("button", {
							onClick: () => toggleCollapse(node.id),
							className: "text-muted mt-0.5",
							"aria-label": isCollapsed ? i18nT("apps.autoResearch.grillTree.expand_2") : i18nT("apps.autoResearch.grillTree.collapse"),
							children: isCollapsed ? /* @__PURE__ */ jsx(ChevronRight, { size: 13 }) : /* @__PURE__ */ jsx(ChevronDown, { size: 13 })
						}) : /* @__PURE__ */ jsx("span", { className: "w-[13px]" }),
						node.kind === "research" ? /* @__PURE__ */ jsx("button", {
							onClick: () => dispatch({
								type: "togglePromote",
								id: node.id
							}),
							className: node.status === "promoted" ? "text-ok mt-0.5" : "text-muted mt-0.5",
							"aria-label": node.status === "promoted" ? i18nT("apps.autoResearch.grillTree.included") : i18nT("apps.autoResearch.grillTree.excluded"),
							children: node.status === "promoted" ? /* @__PURE__ */ jsx(Check, { size: 14 }) : /* @__PURE__ */ jsx(Circle, { size: 14 })
						}) : /* @__PURE__ */ jsx("span", {
							className: "text-warn mt-0.5",
							children: "◆"
						}),
						node.kind === "research" ? /* @__PURE__ */ jsx(AutoGrow, {
							className: "flex-1 bg-transparent text-text border-b border-transparent focus-visible:border-border outline-hidden",
							ariaLabel: i18nT("apps.autoResearch.grillTree.research_question"),
							value: node.text,
							onChange: (t) => dispatch({
								type: "edit",
								id: node.id,
								text: t
							})
						}) : /* @__PURE__ */ jsx("span", {
							className: "flex-1 text-text",
							children: node.text
						}),
						/* @__PURE__ */ jsx("button", {
							onClick: () => dispatch({
								type: "prune",
								id: node.id
							}),
							className: "text-danger mt-0.5",
							"aria-label": i18nT("apps.autoResearch.grillTree.prune"),
							children: /* @__PURE__ */ jsx(Trash2, { size: 12 })
						}),
						/* @__PURE__ */ jsx("span", {
							title: whyPath(node.id),
							className: "text-muted mt-0.5 cursor-help",
							children: /* @__PURE__ */ jsx(HelpCircle, { size: 12 })
						})
					]
				}),
				node.kind === "clarifier" && /* @__PURE__ */ jsxs("div", {
					className: "ml-[34px] mt-1 text-xs text-muted flex items-center gap-2 flex-wrap",
					children: [node.recommended && /* @__PURE__ */ jsxs("span", { children: [
						i18nT("apps.autoResearch.grillTree.rec"),
						" ",
						/* @__PURE__ */ jsx("em", {
							className: "text-text",
							children: node.recommended
						})
					] }), node.status === "answered" ? /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsxs("span", {
							className: "text-text",
							children: [
								i18nT("apps.autoResearch.grillTree.answered"),
								" ",
								node.answer
							]
						}),
						/* @__PURE__ */ jsxs("button", {
							onClick: () => expand(node.id),
							disabled: atMaxDepth || spinning,
							className: "flex items-center gap-1 text-accent disabled:opacity-40",
							children: [
								spinning ? /* @__PURE__ */ jsx(Loader2, {
									size: 12,
									className: "animate-spin"
								}) : /* @__PURE__ */ jsx(Plus, { size: 12 }),
								" ",
								i18nT("apps.autoResearch.grillTree.expand")
							]
						}),
						atMaxDepth && /* @__PURE__ */ jsx("span", {
							className: "text-warn",
							children: i18nT("apps.autoResearch.grillTree.max_depth_add_research_manually_or_prune")
						})
					] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsx(AnswerBox, {
							initial: node.answer,
							onSubmit: (v) => dispatch({
								type: "setAnswer",
								id: node.id,
								answer: v
							})
						}),
						/* @__PURE__ */ jsxs("button", {
							onClick: () => dispatch({
								type: "accept",
								id: node.id
							}),
							className: "flex items-center gap-1 text-accent",
							children: [
								/* @__PURE__ */ jsx(ThumbsUp, { size: 12 }),
								" ",
								i18nT("apps.autoResearch.grillTree.accept")
							]
						}),
						/* @__PURE__ */ jsxs("button", {
							onClick: () => dispatch({
								type: "investigateInstead",
								id: node.id
							}),
							className: "flex items-center gap-1 text-accent",
							children: [
								/* @__PURE__ */ jsx(Search, { size: 12 }),
								" ",
								i18nT("apps.autoResearch.grillTree.investigate_instead")
							]
						})
					] })]
				}),
				noResults && /* @__PURE__ */ jsx("div", {
					className: "ml-[34px] mt-1 text-xs text-muted",
					children: i18nT("apps.autoResearch.grillTree.no_suggestions_add_manually_or_retry")
				}),
				!isCollapsed && kids.map((k) => renderNode(k, depth + 1))
			]
		}, node.id);
	}
	const roots = childrenOf(null);
	if (roots.length === 0) return null;
	return /* @__PURE__ */ jsxs("div", { children: [live.length > SOFT_LIMIT && /* @__PURE__ */ jsx("div", {
		className: "text-xs text-warn mb-1",
		children: i18nT("apps.autoResearch.grillTree.tree_is_getting_large_consider_pruning_branches")
	}), roots.map((n) => renderNode(n, 0))] });
}
// src/clipboard.ts
/**
* Copy text to the clipboard, restated from the dashboard's `utils/clipboard`
* (the SDK has no clipboard helper): the async API when the page has it, else
* the legacy `execCommand('copy')` over a hidden textarea. Resolves to whether
* the text reached the clipboard.
*/
async function copyToClipboard(text) {
	if (typeof navigator.clipboard?.writeText === "function") try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {}
	return execCommandCopy(text);
}
function execCommandCopy(text) {
	if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.appendChild(area);
	area.select();
	try {
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area.remove();
	}
}
// src/ResearchLabPage.tsx
/** The thrown value's own sentence — the api client rejects with an `ApiError`,
*  so this is the backend's message; anything else is stringified rather than
*  swallowed. */
var errMsg = (e) => e instanceof Error && e.message ? e.message : String(e);
var ACTIVE_STATUSES = [
	"running",
	"paused",
	"stagnant",
	"needs_input"
];
function GrowTextarea({ value, onChange, onSubmit, placeholder, className = "", ariaLabel }) {
	const ime = useImeGuard();
	const ref = useRef(null);
	useEffect(() => {
		const el = ref.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		}
	}, [value]);
	return /* @__PURE__ */ jsx("textarea", {
		ref,
		rows: 1,
		"aria-label": ariaLabel,
		className: `resize-none overflow-hidden ${className}`,
		value,
		placeholder,
		onChange: (e) => onChange(e.target.value),
		...ime.bindComposition(),
		onKeyDown: (e) => {
			if (onSubmit && e.key === "Enter" && !e.shiftKey && ime.claimEnter(e)) onSubmit();
		}
	});
}
function EvidenceBadge({ s }) {
	if (s === "strong") return /* @__PURE__ */ jsxs("span", {
		className: "text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-ok inline-flex items-center gap-0.5",
		children: [
			/* @__PURE__ */ jsx(ThumbsUp, { size: 10 }),
			" ",
			i18nT("apps.autoResearch.researchLabPage.strong")
		]
	});
	if (s === "moderate") return /* @__PURE__ */ jsxs("span", {
		className: "text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-warn inline-flex items-center gap-0.5",
		children: [
			/* @__PURE__ */ jsx(ArrowRight, { size: 10 }),
			" ",
			i18nT("apps.autoResearch.researchLabPage.moderate")
		]
	});
	return /* @__PURE__ */ jsxs("span", {
		className: "text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-muted inline-flex items-center gap-0.5",
		children: [
			/* @__PURE__ */ jsx(HelpCircle, { size: 10 }),
			" ",
			i18nT("apps.autoResearch.researchLabPage.weak")
		]
	});
}
var STATE_LABEL_KEY = {
	running: "apps.autoResearch.researchLabPage.state_working",
	needs_input: "apps.autoResearch.researchLabPage.state_needs_input",
	paused: "apps.autoResearch.researchLabPage.state_paused",
	stagnant: "apps.autoResearch.researchLabPage.state_stalled",
	ready: "apps.autoResearch.researchLabPage.state_ready",
	complete: "apps.autoResearch.researchLabPage.state_done",
	failed: "apps.autoResearch.researchLabPage.state_failed",
	stopped: "apps.autoResearch.researchLabPage.state_stopped"
};
var STATE_META = {
	running: {
		color: "text-accent",
		Icon: Loader2,
		spin: true
	},
	needs_input: {
		color: "text-warn",
		Icon: HelpCircle
	},
	paused: {
		color: "text-muted",
		Icon: Pause
	},
	stagnant: {
		color: "text-warn",
		Icon: AlertTriangle
	},
	ready: {
		color: "text-muted",
		Icon: Play
	},
	complete: {
		color: "text-ok",
		Icon: CheckCircle
	},
	failed: {
		color: "text-danger",
		Icon: XCircle
	},
	stopped: {
		color: "text-muted",
		Icon: Square
	}
};
/**
* Localised label for a campaign status. A status the backend reports that has
* no entry above has no catalog entry either, so it is de-snaked and shown
* verbatim rather than dressed up as English copy in every locale.
*
* `hasOwnProperty`, not `in` or a bare index: `status` is backend-supplied, so a
* campaign reporting `toString` or `constructor` would otherwise resolve to an
* inherited `Object.prototype` member and hand a function to i18next.
*/
function stateLabel(status) {
	return Object.prototype.hasOwnProperty.call(STATE_LABEL_KEY, status) ? i18nT(STATE_LABEL_KEY[status]) : status.replace(/_/g, " ");
}
function StateBadge({ status }) {
	const { color, Icon, spin } = Object.prototype.hasOwnProperty.call(STATE_META, status) ? STATE_META[status] : {
		color: "text-muted",
		Icon: HelpCircle,
		spin: void 0
	};
	return /* @__PURE__ */ jsxs("span", {
		className: `text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-elevated inline-flex items-center gap-1 shrink-0 ${color}`,
		title: i18nT("apps.autoResearch.researchLabPage.status", { status }),
		children: [
			/* @__PURE__ */ jsx(Icon, {
				size: 10,
				className: spin ? "animate-spin motion-reduce:animate-none" : void 0
			}),
			" ",
			stateLabel(status)
		]
	});
}
function FindingCard({ f }) {
	const [open, setOpen] = useState(false);
	return /* @__PURE__ */ jsxs("div", {
		className: "border border-border rounded-md p-3 mb-2 bg-card",
		children: [/* @__PURE__ */ jsxs(Clickable, {
			className: "flex items-start gap-2",
			onClick: () => setOpen(!open),
			children: [open ? /* @__PURE__ */ jsx(ChevronDown, { size: 14 }) : /* @__PURE__ */ jsx(ChevronRight, { size: 14 }), /* @__PURE__ */ jsxs("div", {
				className: "flex-1 min-w-0",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2 flex-wrap",
					children: [
						/* @__PURE__ */ jsxs("span", {
							className: "text-xs text-muted",
							children: [
								i18nT("apps.autoResearch.researchLabPage.cycle"),
								" ",
								f.cycle
							]
						}),
						/* @__PURE__ */ jsx(EvidenceBadge, { s: f.evidence_strength }),
						f.verification && /* @__PURE__ */ jsx("span", {
							className: `text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${f.verification.passed ? "bg-ok/15 text-ok-text" : "bg-bg-elevated text-muted"}`,
							children: f.verification.passed ? /* @__PURE__ */ jsxs(Fragment, { children: [
								/* @__PURE__ */ jsx(CheckCircle, { size: 10 }),
								" ",
								i18nT("apps.autoResearch.researchLabPage.goal_met")
							] }) : i18nT("apps.autoResearch.researchLabPage.goal_not_yet")
						})
					]
				}), /* @__PURE__ */ jsxs("div", {
					className: "text-sm font-medium mt-0.5",
					children: [
						"“",
						f.key_insight || f.summary,
						"”"
					]
				})]
			})]
		}), open && /* @__PURE__ */ jsxs("div", {
			className: "mt-2 pl-5 text-sm space-y-1",
			children: [
				/* @__PURE__ */ jsx("p", {
					className: "text-muted",
					children: f.summary
				}),
				f.sources_checked?.length > 0 && /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", {
					className: "text-xs font-medium text-muted",
					children: i18nT("apps.autoResearch.researchLabPage.sources")
				}), f.sources_checked.map((s, i) => /* @__PURE__ */ jsxs("div", {
					className: "text-xs ml-2",
					children: ["• ", s]
				}, i))] }),
				f.sources_empty?.length > 0 && /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", {
					className: "text-xs font-medium text-muted",
					children: i18nT("apps.autoResearch.researchLabPage.searched_empty")
				}), f.sources_empty.map((s, i) => /* @__PURE__ */ jsxs("div", {
					className: "text-xs ml-2 italic",
					children: ["• ", s]
				}, i))] })
			]
		})]
	});
}
function SetupWizard({ onDone, onCancel }) {
	const [step, setStep] = useState(0);
	const [question, setQuestion] = useState("");
	const [subQs, setSubQs] = useState([]);
	const [newSub, setNewSub] = useState("");
	const [maxCycles, setMaxCycles] = useState(30);
	const [maxCyclesTouched, setMaxCyclesTouched] = useState(false);
	const [idleSecs, setIdleSecs] = useState(120);
	const [successCriteria, setSuccessCriteria] = useState("");
	const [autoApprove, setAutoApprove] = useState(false);
	const [parallelWorkers, setParallelWorkers] = useState(1);
	const [executionMode, setExecutionMode] = useState("agent");
	const [model, setModel] = useState("");
	const availableModels = useAvailableModels();
	const [validation, setValidation] = useState(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState(null);
	const [tree, dispatchTree] = useReducer(grillReducer, []);
	const [grilling, setGrilling] = useState(false);
	const [grillUnavailable, setGrillUnavailable] = useState(false);
	const buildSubs = () => [...promotedResearch(tree), ...subQs.map((t) => ({
		text: t,
		origin: "manual"
	}))];
	const scopeConstraints = answeredClarifiers(tree);
	const subCount = promotedResearch(tree).length + subQs.length;
	const grillMe = async () => {
		setGrilling(true);
		setGrillUnavailable(false);
		try {
			const nodes = (await api.researchGrillExpand({
				question,
				tree: [],
				node_id: null,
				mode: "generate"
			}))?.nodes || [];
			if (nodes.length) dispatchTree({
				type: "addChildren",
				nodes
			});
			else setGrillUnavailable(true);
		} catch {
			setGrillUnavailable(true);
		} finally {
			setGrilling(false);
		}
	};
	const onExpand = async (nodeId) => {
		const r = await api.researchGrillExpand({
			question,
			tree,
			node_id: nodeId,
			mode: "generate"
		});
		if (r?.nodes?.length) dispatchTree({
			type: "addChildren",
			nodes: r.nodes
		});
		return { reason: r?.reason };
	};
	useEffect(() => {
		if (step === 1 && !maxCyclesTouched && subCount > 0) setMaxCycles(suggestedMaxCycles(subCount));
	}, [step]);
	const validate = async () => {
		setError(null);
		try {
			const r = await api.researchValidate({
				question,
				sub_questions: buildSubs(),
				max_cycles: maxCycles
			});
			setValidation(r);
		} catch {
			setError(i18nT("apps.autoResearch.researchLabPage.validation_failed_check_your_connection_and_try"));
		}
	};
	useEffect(() => {
		if (step === 2) validate();
	}, [step]);
	const submit = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const c = await api.researchCreate({
				question,
				sub_questions: buildSubs(),
				scope_constraints: scopeConstraints,
				max_cycles: maxCycles,
				idle_secs: idleSecs,
				success_criteria: successCriteria,
				auto_approve: autoApprove,
				parallel_workers: parallelWorkers,
				execution_mode: executionMode,
				model: executionMode === "agent" ? model : ""
			});
			if (c?.id) {
				await api.researchAction(c.id, "start");
				onDone();
			}
		} catch {
			setError(i18nT("apps.autoResearch.researchLabPage.failed_to_start_campaign_please_try_again"));
		} finally {
			setSubmitting(false);
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "max-w-2xl mx-auto",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "flex items-center gap-1 mb-6",
				children: [
					"Question",
					"Limits",
					"Review"
				].map((s, i) => /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-1",
					children: [
						/* @__PURE__ */ jsx("div", {
							className: `w-6 h-6 rounded-full flex items-center justify-center text-xs ${i <= step ? "bg-accent text-accent-fg font-bold" : "bg-border text-muted"}`,
							children: i + 1
						}),
						/* @__PURE__ */ jsx("span", {
							className: `text-xs ${i === step ? "text-text" : "text-muted"}`,
							children: s
						}),
						i < 2 && /* @__PURE__ */ jsx("div", { className: "w-8 h-px bg-border" })
					]
				}, s))
			}),
			step === 0 && /* @__PURE__ */ jsxs("div", {
				className: "space-y-4",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "p-3 rounded-md bg-bg border border-border",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "text-xs text-muted mb-2",
								children: i18nT("apps.autoResearch.researchLabPage.how_sub_agent_execution_is_orchestrated_both_han")
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid grid-cols-2 gap-2",
								children: [/* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => setExecutionMode("agent"),
									className: `text-left p-2 rounded border ${executionMode === "agent" ? "border-accent bg-accent/10" : "border-border"}`,
									children: [/* @__PURE__ */ jsxs("div", {
										className: "font-medium text-sm",
										children: [
											i18nT("apps.autoResearch.researchLabPage.agent"),
											" ",
											/* @__PURE__ */ jsx("span", {
												className: "text-muted font-normal",
												children: i18nT("apps.autoResearch.researchLabPage.adaptive")
											})
										]
									}), /* @__PURE__ */ jsx("div", {
										className: "text-xs text-muted mt-0.5",
										children: i18nT("apps.autoResearch.researchLabPage.the_ai_drives_every_round_itself_deciding_what_t")
									})]
								}), /* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => {
										setExecutionMode("workflow");
										setModel("");
									},
									className: `text-left p-2 rounded border ${executionMode === "workflow" ? "border-accent bg-accent/10" : "border-border"}`,
									children: [/* @__PURE__ */ jsxs("div", {
										className: "font-medium text-sm",
										children: [
											i18nT("apps.autoResearch.researchLabPage.dynamic_workflow"),
											" ",
											/* @__PURE__ */ jsx("span", {
												className: "text-muted font-normal",
												children: i18nT("apps.autoResearch.researchLabPage.scripted")
											})
										]
									}), /* @__PURE__ */ jsx("div", {
										className: "text-xs text-muted mt-0.5",
										children: i18nT("apps.autoResearch.researchLabPage.the_ai_writes_an_orchestration_script_up_front_a")
									})]
								})]
							}),
							executionMode === "workflow" && /* @__PURE__ */ jsxs("div", {
								className: "text-xs text-warn mt-2 flex items-start gap-1",
								children: [/* @__PURE__ */ jsx(AlertTriangle, {
									size: 12,
									className: "mt-0.5 shrink-0"
								}), /* @__PURE__ */ jsx("span", { children: i18nT("apps.autoResearch.researchLabPage.dynamic_workflow_can_fan_out_to_many_sub_agents") })]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("label", {
						htmlFor: "research-question",
						className: "text-sm font-medium",
						children: [i18nT("apps.autoResearch.researchLabPage.what_do_you_want_to_research"), /* @__PURE__ */ jsx("textarea", {
							id: "research-question",
							"aria-label": i18nT("apps.autoResearch.researchLabPage.what_do_you_want_to_research"),
							className: "w-full mt-1 p-2 rounded-md text-sm bg-bg border border-border resize-y",
							rows: 3,
							value: question,
							onChange: (e) => setQuestion(e.target.value),
							placeholder: i18nT("apps.autoResearch.researchLabPage.how_do_other_teams_handle_api_rate_limiting")
						})]
					}), /* @__PURE__ */ jsx("div", {
						className: "text-xs text-muted",
						children: i18nT("apps.autoResearch.researchLabPage.min_20_characters")
					})] }),
					/* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-center justify-between",
							children: [/* @__PURE__ */ jsx("span", {
								className: "text-sm font-medium",
								children: i18nT("apps.autoResearch.researchLabPage.sub_questions")
							}), /* @__PURE__ */ jsxs("button", {
								className: "text-xs text-accent flex items-center gap-1 disabled:opacity-50",
								onClick: grillMe,
								disabled: question.length < 20 || grilling,
								children: [
									/* @__PURE__ */ jsx(Sparkles, { size: 12 }),
									" ",
									grilling ? i18nT("apps.autoResearch.researchLabPage.grilling") : i18nT("apps.autoResearch.researchLabPage.grill_me")
								]
							})]
						}),
						tree.some((n) => n.status !== "pruned") && /* @__PURE__ */ jsx("div", {
							className: "text-xs text-muted mt-1",
							children: i18nT("apps.autoResearch.researchLabPage.answer_clarifiers_to_refine_or_just_pick_sub_que")
						}),
						/* @__PURE__ */ jsx("div", {
							className: "mt-2",
							children: /* @__PURE__ */ jsx(GrillTree, {
								tree,
								dispatch: dispatchTree,
								onExpand
							})
						}),
						grillUnavailable && /* @__PURE__ */ jsx("div", {
							className: "text-xs text-warn mt-2",
							children: i18nT("apps.autoResearch.researchLabPage.grill_unavailable_add_sub_questions_manually_bel")
						}),
						subQs.map((sq, i) => /* @__PURE__ */ jsxs("div", {
							className: "flex items-start gap-2 mt-1",
							children: [/* @__PURE__ */ jsx(GrowTextarea, {
								ariaLabel: i18nT("apps.autoResearch.researchLabPage.sub_question", { n: i + 1 }),
								className: "flex-1 text-sm p-1.5 rounded bg-bg border border-border",
								value: sq,
								onChange: (v) => {
									const n = [...subQs];
									n[i] = v;
									setSubQs(n);
								}
							}), /* @__PURE__ */ jsx("button", {
								className: "text-xs text-danger mt-1.5",
								onClick: () => setSubQs(subQs.filter((_, j) => j !== i)),
								"aria-label": i18nT("apps.autoResearch.researchLabPage.remove_sub_question"),
								children: /* @__PURE__ */ jsx(X, { size: 12 })
							})]
						}, i)),
						/* @__PURE__ */ jsx(GrowTextarea, {
							ariaLabel: i18nT("apps.autoResearch.researchLabPage.add_sub_question_manually"),
							className: "w-full text-sm p-1.5 rounded bg-bg border border-border mt-2",
							placeholder: i18nT("apps.autoResearch.researchLabPage.add_sub_question_manually_enter_shift_enter_for"),
							value: newSub,
							onChange: setNewSub,
							onSubmit: () => {
								if (newSub.trim()) {
									setSubQs([...subQs, newSub.trim()]);
									setNewSub("");
								}
							}
						})
					] })
				]
			}),
			step === 1 && /* @__PURE__ */ jsxs("div", {
				className: "space-y-4",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "text-sm font-medium block",
						children: i18nT("apps.autoResearch.researchLabPage.when_should_the_agent_stop")
					}),
					/* @__PURE__ */ jsx("div", {
						className: "text-xs text-muted",
						children: i18nT("apps.autoResearch.researchLabPage.stops_at_the_cycle_cap_when_the_definition_of_do")
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "text-sm",
								children: i18nT("apps.autoResearch.researchLabPage.max_cycles")
							}),
							/* @__PURE__ */ jsx("input", {
								type: "number",
								"aria-label": i18nT("apps.autoResearch.researchLabPage.max_cycles_2"),
								min: 5,
								max: 100,
								value: maxCycles,
								className: "w-20 text-sm px-3 py-2 rounded-md bg-bg-elevated border border-border text-text outline-hidden focus-ring",
								onChange: (e) => {
									setMaxCyclesTouched(true);
									setMaxCycles(Number(e.target.value));
								}
							}),
							subCount > 0 && !maxCyclesTouched && /* @__PURE__ */ jsxs("span", {
								className: "text-xs text-muted",
								children: [
									i18nT("apps.autoResearch.researchLabPage.suggested_from"),
									" ",
									subCount,
									" ",
									i18nT("apps.autoResearch.researchLabPage.sub_questions_2")
								]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx("span", {
							className: "text-sm",
							children: i18nT("apps.autoResearch.researchLabPage.idle_between_cycles")
						}), /* @__PURE__ */ jsx(Select, {
							"aria-label": i18nT("apps.autoResearch.researchLabPage.idle_between_cycles_2"),
							options: [
								"30",
								"60",
								"120"
							],
							optionLabels: [
								i18nT("apps.autoResearch.researchLabPage.30s"),
								i18nT("apps.autoResearch.researchLabPage.60s"),
								i18nT("apps.autoResearch.researchLabPage.120s")
							],
							value: String(idleSecs),
							onChange: (v) => setIdleSecs(Number(v))
						})]
					}),
					/* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsx("span", {
							className: "text-sm font-medium block",
							children: i18nT("apps.autoResearch.researchLabPage.definition_of_done_optional")
						}),
						/* @__PURE__ */ jsx("textarea", {
							"aria-label": i18nT("apps.autoResearch.researchLabPage.definition_of_done_optional"),
							className: "w-full text-sm p-1.5 rounded bg-bg border border-border mt-1 resize-y",
							rows: 2,
							placeholder: i18nT("apps.autoResearch.researchLabPage.e_g_ai_code_review_finds_no_blocking_issues_and"),
							value: successCriteria,
							onChange: (e) => setSuccessCriteria(e.target.value)
						}),
						/* @__PURE__ */ jsx("div", {
							className: "text-xs text-muted mt-1",
							children: i18nT("apps.autoResearch.researchLabPage.if_set_the_agent_verifies_against_this_each_cycl")
						})
					] }),
					/* @__PURE__ */ jsxs("label", {
						htmlFor: "auto-approve",
						className: "flex items-center gap-2 text-sm",
						children: [/* @__PURE__ */ jsx("input", {
							id: "auto-approve",
							type: "checkbox",
							"aria-label": i18nT("apps.autoResearch.researchLabPage.run_unattended_skip_clarification_questions"),
							checked: autoApprove,
							onChange: (e) => setAutoApprove(e.target.checked)
						}), i18nT("apps.autoResearch.researchLabPage.run_unattended_skip_clarification_questions")]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "text-sm",
								children: i18nT("apps.autoResearch.researchLabPage.parallel_workers")
							}),
							/* @__PURE__ */ jsx("input", {
								type: "number",
								"aria-label": i18nT("apps.autoResearch.researchLabPage.parallel_workers_2"),
								min: 1,
								max: 5,
								value: parallelWorkers,
								className: "w-16 text-sm px-3 py-2 rounded-md bg-bg-elevated border border-border text-text outline-hidden focus-ring",
								onChange: (e) => setParallelWorkers(Math.min(5, Math.max(1, Number(e.target.value))))
							}),
							/* @__PURE__ */ jsx("span", {
								className: "text-xs text-muted",
								children: parallelWorkers > 1 ? `${parallelWorkers} sub-questions investigated in parallel each cycle` : "sequential (default)"
							})
						]
					}),
					executionMode === "agent" && /* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx("span", {
							className: "text-sm",
							children: i18nT("apps.autoResearch.researchLabPage.model")
						}), /* @__PURE__ */ jsx(Select, {
							"aria-label": i18nT("apps.autoResearch.researchLabPage.model"),
							options: availableModels.map((m) => m.name).filter((n) => n !== "auto"),
							clearLabel: i18nT("apps.autoResearch.researchLabPage.model_default_inherit"),
							value: model,
							onChange: setModel
						})]
					})
				]
			}),
			step === 2 && /* @__PURE__ */ jsxs("div", {
				className: "space-y-3",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "text-sm font-medium block",
						children: i18nT("apps.autoResearch.researchLabPage.pre_flight_check")
					}),
					validation ? /* @__PURE__ */ jsxs(Fragment, { children: [
						validation.errors.map((e, i) => /* @__PURE__ */ jsxs("div", {
							className: "text-sm flex items-center gap-1",
							children: [
								/* @__PURE__ */ jsx(XCircle, {
									size: 14,
									className: "text-danger"
								}),
								" ",
								e
							]
						}, i)),
						validation.errors.length === 0 && /* @__PURE__ */ jsxs("div", {
							className: "text-sm text-ok flex items-center gap-1",
							children: [
								/* @__PURE__ */ jsx(CheckCircle, { size: 14 }),
								" ",
								i18nT("apps.autoResearch.researchLabPage.all_checks_passed")
							]
						}),
						validation.warnings.map((w, i) => /* @__PURE__ */ jsxs("div", {
							className: "text-sm text-warn flex items-center gap-1",
							children: [
								/* @__PURE__ */ jsx(AlertTriangle, { size: 14 }),
								" ",
								w
							]
						}, i)),
						/* @__PURE__ */ jsxs("div", {
							className: "mt-3 p-3 rounded text-sm bg-bg border border-border",
							children: [
								/* @__PURE__ */ jsx("div", { children: i18nT("apps.autoResearch.researchLabPage.research_question", { question: `${question.slice(0, 50)}${question.length > 50 ? "..." : ""}` }) }),
								/* @__PURE__ */ jsxs("div", {
									className: "text-muted",
									children: [
										i18nT("apps.autoResearch.researchLabPage.up_to"),
										" ",
										maxCycles,
										" ",
										i18nT("apps.autoResearch.researchLabPage.cycles"),
										" ",
										idleSecs,
										i18nT("apps.autoResearch.researchLabPage.s_idle"),
										validation.estimated_duration_min,
										" ",
										i18nT("apps.autoResearch.researchLabPage.min")
									]
								}),
								successCriteria && /* @__PURE__ */ jsxs("div", {
									className: "text-muted",
									children: [
										i18nT("apps.autoResearch.researchLabPage.done_when"),
										" ",
										successCriteria
									]
								}),
								executionMode === "agent" && /* @__PURE__ */ jsx("div", {
									className: "text-muted",
									children: i18nT("apps.autoResearch.researchLabPage.model_line", { model: model || i18nT("apps.autoResearch.researchLabPage.model_default_inherit") })
								})
							]
						})
					] }) : /* @__PURE__ */ jsx("div", {
						className: "text-sm text-muted",
						children: i18nT("apps.autoResearch.researchLabPage.validating")
					}),
					/* @__PURE__ */ jsx(ErrorNotice, { message: error })
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "flex justify-between mt-6",
				children: [/* @__PURE__ */ jsx("button", {
					className: "text-sm text-muted hover:text-text",
					onClick: step === 0 ? onCancel : () => setStep(step - 1),
					children: step === 0 ? i18nT("apps.autoResearch.researchLabPage.cancel") : i18nT("apps.autoResearch.researchLabPage.back")
				}), step < 2 ? /* @__PURE__ */ jsx("button", {
					className: "text-sm px-3 py-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-50",
					disabled: step === 0 && question.length < 20,
					onClick: () => setStep(step + 1),
					children: i18nT("apps.autoResearch.researchLabPage.next")
				}) : /* @__PURE__ */ jsx("button", {
					className: "text-sm px-3 py-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-50",
					disabled: !validation?.can_start || submitting,
					onClick: submit,
					children: submitting ? i18nT("apps.autoResearch.researchLabPage.starting") : i18nT("apps.autoResearch.researchLabPage.start_campaign")
				})]
			})
		]
	});
}
var FORK_TREE_KEY = (pid) => `mc-fork-tree:${pid}`;
var FORK_PENDING_KEY = (pid) => `mc-fork-pending:${pid}`;
function loadForkTree(pid) {
	try {
		const raw = sessionStorage.getItem(FORK_TREE_KEY(pid));
		const v = raw ? JSON.parse(raw) : [];
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}
var showsWithheld = (c) => !!c.model_withheld && !!c.model && ACTIVE_STATUSES.includes(c.status);
function ModelWithheldNotice({ c, className = "" }) {
	if (!showsWithheld(c)) return null;
	const text = c.served_model ? i18nT("apps.autoResearch.researchLabPage.model_withheld_notice", {
		requested: c.model,
		actual: c.served_model
	}) : i18nT("apps.autoResearch.researchLabPage.model_withheld_notice_default", { requested: c.model });
	return /* @__PURE__ */ jsxs("div", {
		role: "status",
		className: `p-2 rounded-md border bg-bg-elevated text-xs flex items-start gap-1 ${className}`,
		style: { borderColor: "color-mix(in srgb, var(--info) 45%, transparent)" },
		children: [
			/* @__PURE__ */ jsx(Info, {
				size: 12,
				className: "mt-0.5 shrink-0 text-info"
			}),
			" ",
			/* @__PURE__ */ jsx("span", { children: text })
		]
	});
}
function ModelLine({ c }) {
	if (!c.model) return null;
	return /* @__PURE__ */ jsx("span", { children: i18nT("apps.autoResearch.researchLabPage.model_line_picked", { model: c.model }) });
}
function ForkFlow({ parentId, onCancel, onDone }) {
	const [tree, dispatchTree] = useReducer(grillReducer, parentId, loadForkTree);
	const [grilling, setGrilling] = useState(false);
	const [forking, setForking] = useState(false);
	const [error, setError] = useState(null);
	const [manualSubs, setManualSubs] = useState([]);
	const [newSub, setNewSub] = useState("");
	const { data: parentCampaign } = useQuery({
		queryKey: ["research-campaign", parentId],
		queryFn: () => api.researchCampaign(parentId)
	});
	const question = parentCampaign?.question || "";
	const availableModels = useAvailableModels();
	const [forkModel, setForkModel] = useState(null);
	const parentModel = parentCampaign?.model || "";
	const model = forkModel ?? parentModel;
	const modelOptions = [.../* @__PURE__ */ new Set([...availableModels.map((m) => m.name).filter((n) => n !== "auto"), ...parentModel ? [parentModel] : []])];
	const clearPersisted = () => {
		try {
			sessionStorage.removeItem(FORK_TREE_KEY(parentId));
			sessionStorage.removeItem(FORK_PENDING_KEY(parentId));
		} catch {}
	};
	useEffect(() => {
		try {
			if (tree.length) sessionStorage.setItem(FORK_TREE_KEY(parentId), JSON.stringify(tree));
			else sessionStorage.removeItem(FORK_TREE_KEY(parentId));
		} catch {}
	}, [tree, parentId]);
	const startChallenge = async () => {
		setGrilling(true);
		setError(null);
		try {
			sessionStorage.setItem(FORK_PENDING_KEY(parentId), "1");
		} catch {}
		try {
			const r = await api.researchGrillExpand({
				question,
				tree: [],
				node_id: null,
				mode: "challenge",
				campaign_id: parentId
			});
			if (r?.nodes?.length) dispatchTree({
				type: "addChildren",
				nodes: r.nodes
			});
		} catch {
			setError(i18nT("apps.autoResearch.researchLabPage.could_not_generate_challenges_please_try_again"));
		} finally {
			setGrilling(false);
			try {
				sessionStorage.removeItem(FORK_PENDING_KEY(parentId));
			} catch {}
		}
	};
	useEffect(() => {
		if (grilling || tree.length || !question) return;
		let pending = false;
		try {
			pending = sessionStorage.getItem(FORK_PENDING_KEY(parentId)) === "1";
		} catch {}
		if (pending) startChallenge();
	}, [
		question,
		tree.length,
		grilling,
		parentId
	]);
	const onExpand = async (nodeId) => {
		const r = await api.researchGrillExpand({
			question,
			tree,
			node_id: nodeId,
			mode: "challenge",
			campaign_id: parentId
		});
		if (r?.nodes?.length) dispatchTree({
			type: "addChildren",
			nodes: r.nodes
		});
		return { reason: r?.reason };
	};
	const doFork = async () => {
		setForking(true);
		setError(null);
		try {
			const subs = [...promotedResearch(tree), ...manualSubs.map((t) => ({
				text: t,
				origin: "manual"
			}))];
			const constraints = answeredClarifiers(tree);
			const maxCycles = suggestedMaxCycles(subs.length);
			const r = await api.researchAction(parentId, "fork", {
				sub_questions: subs,
				scope_constraints: constraints,
				max_cycles: maxCycles,
				grill_tree: tree,
				question,
				model
			});
			if (r?.id) {
				try {
					await api.researchAction(r.id, "start");
				} catch {}
				clearPersisted();
				onDone();
			} else setError(i18nT("apps.autoResearch.researchLabPage.fork_failed_no_campaign_was_created"));
		} catch {
			setError(i18nT("apps.autoResearch.researchLabPage.fork_failed_please_try_again"));
		} finally {
			setForking(false);
		}
	};
	const subCount = promotedResearch(tree).length + manualSubs.length;
	return /* @__PURE__ */ jsxs("div", {
		className: "max-w-2xl mx-auto space-y-4",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "text-sm text-muted",
				children: i18nT("apps.autoResearch.researchLabPage.challenge_the_findings_from_question", { question: question?.slice(0, 60) })
			}),
			parentCampaign && /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ jsx("span", {
					className: "text-sm",
					children: i18nT("apps.autoResearch.researchLabPage.model")
				}), /* @__PURE__ */ jsx(Select, {
					"aria-label": i18nT("apps.autoResearch.researchLabPage.model"),
					options: modelOptions,
					clearLabel: i18nT("apps.autoResearch.researchLabPage.model_default_inherit"),
					value: model,
					onChange: setForkModel
				})]
			}), model === parentModel && /* @__PURE__ */ jsx("div", {
				className: "text-xs text-muted mt-1",
				children: i18nT("apps.autoResearch.researchLabPage.model_fork_hint")
			})] }),
			/* @__PURE__ */ jsx(ErrorNotice, { message: error }),
			tree.length === 0 ? /* @__PURE__ */ jsx("button", {
				className: "text-sm px-3 py-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-50",
				disabled: grilling || !question,
				onClick: startChallenge,
				children: grilling ? i18nT("apps.autoResearch.researchLabPage.challenging") : /* @__PURE__ */ jsxs(Fragment, { children: [
					/* @__PURE__ */ jsx(Flame, {
						size: 12,
						className: "inline"
					}),
					" ",
					i18nT("apps.autoResearch.researchLabPage.challenge_findings")
				] })
			}) : /* @__PURE__ */ jsxs(Fragment, { children: [
				/* @__PURE__ */ jsx("div", {
					className: "text-xs text-muted",
					children: i18nT("apps.autoResearch.researchLabPage.answer_challenges_to_refine_or_just_pick_sub_que")
				}),
				/* @__PURE__ */ jsx(GrillTree, {
					tree,
					dispatch: dispatchTree,
					onExpand
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-3",
					children: [manualSubs.map((sq, i) => /* @__PURE__ */ jsxs("div", {
						className: "flex items-start gap-2 mt-1",
						children: [/* @__PURE__ */ jsx(GrowTextarea, {
							ariaLabel: i18nT("apps.autoResearch.researchLabPage.sub_question", { n: i + 1 }),
							className: "flex-1 text-sm p-1.5 rounded bg-bg border border-border",
							value: sq,
							onChange: (v) => {
								const n = [...manualSubs];
								n[i] = v;
								setManualSubs(n);
							}
						}), /* @__PURE__ */ jsx("button", {
							className: "text-xs text-danger mt-1.5",
							onClick: () => setManualSubs(manualSubs.filter((_, j) => j !== i)),
							"aria-label": i18nT("apps.autoResearch.researchLabPage.remove_sub_question"),
							children: /* @__PURE__ */ jsx(X, { size: 12 })
						})]
					}, i)), /* @__PURE__ */ jsx(GrowTextarea, {
						ariaLabel: i18nT("apps.autoResearch.researchLabPage.add_your_own_sub_question_or_guidance"),
						className: "w-full text-sm p-1.5 rounded bg-bg border border-border mt-1",
						placeholder: i18nT("apps.autoResearch.researchLabPage.add_your_own_sub_question_or_guidance_enter_shif"),
						value: newSub,
						onChange: setNewSub,
						onSubmit: () => {
							if (newSub.trim()) {
								setManualSubs([...manualSubs, newSub.trim()]);
								setNewSub("");
							}
						}
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex justify-between mt-4",
					children: [/* @__PURE__ */ jsx("button", {
						className: "text-sm text-muted",
						onClick: () => {
							clearPersisted();
							onCancel();
						},
						children: i18nT("apps.autoResearch.researchLabPage.cancel")
					}), /* @__PURE__ */ jsx("button", {
						className: "text-sm px-3 py-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-50",
						disabled: subCount === 0 || forking,
						onClick: doFork,
						children: forking ? i18nT("apps.autoResearch.researchLabPage.forking") : `Fork with ${subCount} sub-questions →`
					})]
				})
			] })
		]
	});
}
function ExportArtifactButton({ id }) {
	const qc = useQueryClient();
	const { data: rstatus } = useQuery({
		queryKey: ["research-report-status", id],
		queryFn: () => api.researchReportStatus(id)
	});
	const [loading, setLoading] = useState(false);
	const [localSlug, setLocalSlug] = useState(null);
	const slug = localSlug ?? rstatus?.slug ?? null;
	const go = async () => {
		setLoading(true);
		try {
			const r = await api.researchToArtifact(id);
			if (r?.slug) setLocalSlug(r.slug);
			qc.invalidateQueries({ queryKey: ["research-report-status", id] });
		} catch {
			alert(i18nT("apps.autoResearch.researchLabPage.failed_to_export_as_artifact"));
		} finally {
			setLoading(false);
		}
	};
	if (slug) return /* @__PURE__ */ jsxs("span", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ jsxs("a", {
			href: `/artifacts/${slug}`,
			target: "_blank",
			rel: "noopener noreferrer",
			className: "text-xs text-ok flex items-center gap-1",
			children: [
				/* @__PURE__ */ jsx(FileText, { size: 12 }),
				" ",
				i18nT("apps.autoResearch.researchLabPage.view_report"),
				" ",
				/* @__PURE__ */ jsx(ExternalLink, { size: 10 })
			]
		}), /* @__PURE__ */ jsxs("button", {
			className: "text-xs px-2 py-1 rounded bg-bg-elevated disabled:opacity-50",
			disabled: loading,
			onClick: go,
			title: i18nT("apps.autoResearch.researchLabPage.regenerate_the_report_updates_the_same_artifact"),
			children: [
				/* @__PURE__ */ jsx(RefreshCw, {
					size: 12,
					className: "inline"
				}),
				" ",
				loading ? i18nT("apps.autoResearch.researchLabPage.regenerating") : i18nT("apps.autoResearch.researchLabPage.regenerate")
			]
		})]
	});
	return /* @__PURE__ */ jsxs("button", {
		className: "text-xs px-2 py-1 rounded bg-bg-elevated disabled:opacity-50",
		disabled: loading,
		onClick: go,
		children: [
			/* @__PURE__ */ jsx(FileText, {
				size: 12,
				className: "inline"
			}),
			" ",
			loading ? i18nT("apps.autoResearch.researchLabPage.exporting") : i18nT("apps.autoResearch.researchLabPage.export_as_artifact")
		]
	});
}
function AddToKnowledgeButton({ id }) {
	const qc = useQueryClient();
	const { data: kstatus } = useQuery({
		queryKey: ["research-knowledge-status", id],
		queryFn: () => api.researchKnowledgeStatus(id)
	});
	const [status, setStatus] = useState("idle");
	const go = async () => {
		setStatus("loading");
		try {
			await api.researchToKnowledge(id);
			setStatus("done");
			qc.invalidateQueries({ queryKey: ["research-knowledge-status", id] });
		} catch (e) {
			const err = e;
			if (err?.status === 409) setStatus("exists");
			else {
				setStatus("idle");
				alert(err?.message || i18nT("apps.autoResearch.researchLabPage.failed_to_add_to_knowledge_library"));
			}
		}
	};
	if (status === "done") return /* @__PURE__ */ jsxs("span", {
		className: "text-xs text-ok flex items-center gap-1",
		children: [
			/* @__PURE__ */ jsx(CheckCircle, { size: 12 }),
			" ",
			i18nT("apps.autoResearch.researchLabPage.added_to_knowledge")
		]
	});
	if (status === "exists" || kstatus?.in_library) return /* @__PURE__ */ jsxs("span", {
		className: "text-xs text-muted flex items-center gap-1",
		children: [
			/* @__PURE__ */ jsx(BookOpen, { size: 12 }),
			" ",
			i18nT("apps.autoResearch.researchLabPage.already_in_knowledge")
		]
	});
	return /* @__PURE__ */ jsxs("button", {
		className: "text-xs px-2 py-1 rounded bg-bg-elevated disabled:opacity-50",
		disabled: status === "loading",
		onClick: go,
		children: [
			/* @__PURE__ */ jsx(BookOpen, {
				size: 12,
				className: "inline"
			}),
			" ",
			status === "loading" ? i18nT("apps.autoResearch.researchLabPage.adding") : i18nT("apps.autoResearch.researchLabPage.add_to_knowledge")
		]
	});
}
function splitReportSections(md) {
	const lines = md.split("\n");
	const sections = [];
	let cur = [];
	for (const line of lines) if (/^#{1,3}\s/.test(line) && cur.some((l) => l.trim() !== "")) {
		sections.push(cur.join("\n").trim());
		cur = [line];
	} else cur.push(line);
	if (cur.some((l) => l.trim() !== "")) sections.push(cur.join("\n").trim());
	return sections.length ? sections : [md];
}
function ReportSections({ report }) {
	const [copied, setCopied] = useState(null);
	const sections = splitReportSections(report);
	const copy = async (text, i) => {
		if (!await copyToClipboard(text)) return;
		setCopied(i);
		setTimeout(() => setCopied((c) => c === i ? null : c), 1500);
	};
	return /* @__PURE__ */ jsx(Fragment, { children: sections.map((sec, i) => /* @__PURE__ */ jsxs("div", {
		className: "relative border border-border rounded-md p-3 mb-2 bg-card",
		children: [/* @__PURE__ */ jsx("button", {
			className: "absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-bg-elevated",
			title: i18nT("apps.autoResearch.researchLabPage.copy_this_section_s_markdown_to_paste_into_chat"),
			onClick: () => copy(sec, i),
			children: copied === i ? i18nT("apps.autoResearch.researchLabPage.copied") : i18nT("apps.autoResearch.researchLabPage.copy")
		}), /* @__PURE__ */ jsx(MarkdownRenderer, { content: sec })]
	}, i)) });
}
function SubQuestionAdder({ id, campaign }) {
	const [text, setText] = useState("");
	const [open, setOpen] = useState(false);
	const qc = useQueryClient();
	const addMut = useMutation({
		mutationFn: (t) => api.researchAddQuestion(id, t),
		onSuccess: () => {
			setText("");
			qc.invalidateQueries({ queryKey: ["research-campaign", id] });
		}
	});
	const subs = (() => {
		try {
			return JSON.parse(campaign.sub_questions || "[]");
		} catch {
			return [];
		}
	})();
	if (!ACTIVE_STATUSES.includes(campaign.status)) return null;
	const originLabel = (o) => o === "manual" ? i18nT("apps.autoResearch.researchLabPage.your_guidance") : o === "emergent" ? i18nT("apps.autoResearch.researchLabPage.emergent") : o || "grill";
	return /* @__PURE__ */ jsxs("div", {
		className: "mb-4",
		children: [/* @__PURE__ */ jsxs(Clickable, {
			className: "flex items-center gap-1 text-sm font-medium",
			onClick: () => setOpen(!open),
			children: [
				open ? /* @__PURE__ */ jsx(ChevronDown, { size: 14 }) : /* @__PURE__ */ jsx(ChevronRight, { size: 14 }),
				" ",
				i18nT("apps.autoResearch.researchLabPage.sub_questions_guidance_count", { count: subs.length })
			]
		}), open && /* @__PURE__ */ jsxs("div", {
			className: "mt-2 pl-4 space-y-1",
			children: [subs.map((s, i) => /* @__PURE__ */ jsxs("div", {
				className: "text-xs flex items-center gap-1.5",
				children: [
					s.status === "answered" ? /* @__PURE__ */ jsx(CheckCircle, {
						size: 10,
						className: "text-ok"
					}) : /* @__PURE__ */ jsx(HelpCircle, {
						size: 10,
						className: "text-muted"
					}),
					/* @__PURE__ */ jsx("span", { children: s.text }),
					/* @__PURE__ */ jsxs("span", {
						className: "text-muted italic",
						children: [
							"(",
							originLabel(s.origin),
							")"
						]
					})
				]
			}, i)), ACTIVE_STATUSES.includes(campaign.status) && /* @__PURE__ */ jsxs("div", {
				className: "mt-2",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx(GrowTextarea, {
							ariaLabel: i18nT("apps.autoResearch.researchLabPage.add_guidance_or_a_sub_question"),
							className: "flex-1 text-xs p-1.5 rounded bg-bg border border-border",
							placeholder: i18nT("apps.autoResearch.researchLabPage.add_guidance_or_a_sub_question_enter_shift_enter"),
							value: text,
							onChange: setText,
							onSubmit: () => {
								if (text.trim()) addMut.mutate(text.trim());
							}
						}), /* @__PURE__ */ jsx("button", {
							className: "text-xs px-2 py-1 rounded bg-accent text-accent-fg disabled:opacity-50",
							disabled: !text.trim() || addMut.isPending,
							onClick: () => addMut.mutate(text.trim()),
							children: addMut.isPending ? "…" : i18nT("apps.autoResearch.researchLabPage.add")
						})]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "text-[10px] text-muted mt-1",
						children: i18nT("apps.autoResearch.researchLabPage.free_form_a_sub_question_or_an_instruction_the_a")
					}),
					addMut.isError && /* @__PURE__ */ jsx(ErrorNotice, {
						message: errMsg(addMut.error),
						variant: "inline",
						className: "mt-1"
					})
				]
			})]
		})]
	});
}
function CampaignDetail({ id, onBack, onFork, onOpen }) {
	const qc = useQueryClient();
	const [sseFailed, setSseFailed] = useState(false);
	const { data: campaign } = useQuery({
		queryKey: ["research-campaign", id],
		queryFn: () => api.researchCampaign(id),
		refetchInterval: sseFailed ? 5e3 : false
	});
	useEffect(() => {
		setSseFailed(false);
		const es = new EventSource(campaignStreamUrl(id));
		es.onmessage = () => {
			qc.invalidateQueries({ queryKey: ["research-campaign", id] });
		};
		es.onerror = () => {
			setSseFailed(true);
			es.close();
		};
		return () => {
			es.close();
		};
	}, [id, qc]);
	const [showNudge, setShowNudge] = useState(false);
	const [nudgeText, setNudgeText] = useState("");
	const [answerText, setAnswerText] = useState("");
	const [questionExpanded, setQuestionExpanded] = useState(false);
	const [showReport, setShowReport] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const { data: reportData } = useQuery({
		queryKey: ["research-report", id],
		queryFn: () => api.researchReport(id),
		enabled: showReport
	});
	const actionMut = useMutation({
		mutationFn: (action) => api.researchAction(id, action),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["research-campaign", id] })
	});
	const nudgeMut = useMutation({
		mutationFn: (text) => api.researchNudge(id, text),
		onSuccess: () => {
			setShowNudge(false);
			setNudgeText("");
			setAnswerText("");
			qc.invalidateQueries({ queryKey: ["research-campaign", id] });
		}
	});
	const deleteMut = useMutation({
		mutationFn: () => api.researchDelete(id),
		onSuccess: () => {
			setConfirmDelete(false);
			qc.invalidateQueries({ queryKey: ["research-campaigns"] });
			onBack();
		}
	});
	if (!campaign) return /* @__PURE__ */ jsx("div", {
		className: "text-sm text-muted",
		children: i18nT("apps.autoResearch.researchLabPage.loading")
	});
	const findings = campaign.findings || [];
	const isActive = ACTIVE_STATUSES.includes(campaign.status);
	const sorted = isActive ? [...findings].reverse() : findings;
	return /* @__PURE__ */ jsxs("div", { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "flex items-center gap-3 mb-4",
			children: [
				/* @__PURE__ */ jsx("button", {
					className: "text-sm text-accent",
					onClick: onBack,
					children: i18nT("apps.autoResearch.researchLabPage.back")
				}),
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: campaign.name
				}),
				/* @__PURE__ */ jsx("span", {
					className: "text-xs px-2 py-0.5 rounded bg-bg-elevated",
					children: campaign.status
				}),
				/* @__PURE__ */ jsxs("button", {
					className: "text-xs px-2 py-1 rounded bg-bg-elevated text-danger ml-auto",
					onClick: () => {
						deleteMut.reset();
						setConfirmDelete(true);
					},
					children: [
						/* @__PURE__ */ jsx(Trash2, {
							size: 12,
							className: "inline"
						}),
						" ",
						i18nT("apps.autoResearch.researchLabPage.delete")
					]
				})
			]
		}),
		/* @__PURE__ */ jsxs(Modal, {
			open: confirmDelete,
			onClose: () => {
				if (!deleteMut.isPending) setConfirmDelete(false);
			},
			title: i18nT("apps.autoResearch.researchLabPage.delete_campaign"),
			maxWidth: 400,
			footer: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Btn, {
				disabled: deleteMut.isPending,
				onClick: () => setConfirmDelete(false),
				children: i18nT("apps.autoResearch.researchLabPage.cancel")
			}), /* @__PURE__ */ jsx(Btn, {
				danger: true,
				disabled: deleteMut.isPending,
				onClick: () => deleteMut.mutate(),
				children: deleteMut.isPending ? i18nT("apps.autoResearch.researchLabPage.deleting") : i18nT("apps.autoResearch.researchLabPage.delete_campaign_button")
			})] }),
			children: [/* @__PURE__ */ jsx("p", {
				className: "text-sm text-muted m-0",
				children: i18nT("apps.autoResearch.researchLabPage.delete_this_campaign_and_its_report_this_cannot")
			}), deleteMut.isError && /* @__PURE__ */ jsx(ErrorNotice, {
				message: deleteMut.error instanceof Error && deleteMut.error.message ? deleteMut.error.message : i18nT("apps.autoResearch.researchLabPage.delete_failed"),
				askAgent: true,
				className: "mt-2"
			})]
		}),
		campaign.question && (() => {
			const isLong = campaign.question.length > 280;
			return /* @__PURE__ */ jsxs("div", {
				className: "mb-4",
				children: [/* @__PURE__ */ jsx("div", {
					className: `text-sm text-muted break-words ${isLong && !questionExpanded ? "line-clamp-3" : ""}`,
					children: campaign.question
				}), isLong && /* @__PURE__ */ jsx("button", {
					className: "text-xs text-accent mt-1 inline-flex items-center gap-0.5",
					onClick: () => setQuestionExpanded((v) => !v),
					children: questionExpanded ? /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsx(ChevronDown, { size: 12 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.show_less")
					] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsx(ChevronRight, { size: 12 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.show_more")
					] })
				})]
			});
		})(),
		/* @__PURE__ */ jsxs("div", {
			className: "flex items-center justify-between mb-4",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "text-sm text-muted flex flex-wrap gap-x-3",
				children: [/* @__PURE__ */ jsxs("span", { children: [
					i18nT("apps.autoResearch.researchLabPage.cycle"),
					" ",
					campaign.total_cycles,
					"/",
					campaign.max_cycles,
					" · ",
					findings.filter((f) => f.new_findings_count > 0).length,
					" ",
					i18nT("apps.autoResearch.researchLabPage.findings")
				] }), /* @__PURE__ */ jsx(ModelLine, { c: campaign })]
			}), isActive && /* @__PURE__ */ jsxs("div", {
				className: "flex gap-2",
				children: [
					campaign.status === "running" && /* @__PURE__ */ jsxs("button", {
						className: "text-xs px-2 py-1 rounded bg-bg-elevated",
						onClick: () => actionMut.mutate("pause"),
						children: [
							/* @__PURE__ */ jsx(Pause, {
								size: 12,
								className: "inline"
							}),
							" ",
							i18nT("apps.autoResearch.researchLabPage.pause")
						]
					}),
					campaign.status !== "running" && /* @__PURE__ */ jsxs("button", {
						className: "text-xs px-2 py-1 rounded bg-bg-elevated",
						onClick: () => actionMut.mutate("resume"),
						children: [
							/* @__PURE__ */ jsx(Play, {
								size: 12,
								className: "inline"
							}),
							" ",
							i18nT("apps.autoResearch.researchLabPage.resume")
						]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "text-xs px-2 py-1 rounded bg-bg-elevated",
						onClick: () => actionMut.mutate("stop"),
						children: [
							/* @__PURE__ */ jsx(Square, {
								size: 12,
								className: "inline"
							}),
							" ",
							i18nT("apps.autoResearch.researchLabPage.stop")
						]
					}),
					/* @__PURE__ */ jsxs("button", {
						className: "text-xs px-2 py-1 rounded bg-bg-elevated",
						onClick: () => setShowNudge(true),
						children: [
							/* @__PURE__ */ jsx(MessageCircle, {
								size: 12,
								className: "inline"
							}),
							" ",
							i18nT("apps.autoResearch.researchLabPage.nudge")
						]
					})
				]
			})]
		}),
		/* @__PURE__ */ jsx(ModelWithheldNotice, {
			c: campaign,
			className: "mb-4"
		}),
		actionMut.isError && /* @__PURE__ */ jsx(ErrorNotice, {
			message: errMsg(actionMut.error),
			askAgent: true,
			className: "mb-4"
		}),
		campaign.status === "stagnant" && /* @__PURE__ */ jsxs("div", {
			className: "p-3 rounded-md mb-4 border border-warn bg-warn/10",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "text-sm font-medium text-warn flex items-center gap-1",
					children: [
						/* @__PURE__ */ jsx(AlertTriangle, { size: 14 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.research_stalled")
					]
				}),
				/* @__PURE__ */ jsx("div", {
					className: "text-xs mt-1",
					children: i18nT("apps.autoResearch.researchLabPage.no_new_findings_in_the_last_5_cycles")
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex gap-2 mt-2",
					children: [
						/* @__PURE__ */ jsx("button", {
							className: "text-xs px-2 py-1 rounded bg-accent text-accent-fg",
							onClick: () => setShowNudge(true),
							children: i18nT("apps.autoResearch.researchLabPage.give_direction")
						}),
						/* @__PURE__ */ jsx("button", {
							className: "text-xs px-2 py-1 rounded bg-bg-elevated",
							onClick: () => actionMut.mutate("stop"),
							children: i18nT("apps.autoResearch.researchLabPage.stop")
						}),
						/* @__PURE__ */ jsx("button", {
							className: "text-xs px-2 py-1 rounded bg-bg-elevated",
							onClick: () => actionMut.mutate("resume"),
							children: i18nT("apps.autoResearch.researchLabPage.continue")
						})
					]
				})
			]
		}),
		campaign.status === "needs_input" && /* @__PURE__ */ jsxs("div", {
			className: "p-3 rounded-md mb-4 border bg-bg-elevated",
			style: { borderColor: "color-mix(in srgb, var(--info) 45%, transparent)" },
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "text-sm font-medium text-info flex items-center gap-1",
					children: [
						/* @__PURE__ */ jsx(MessageCircle, { size: 14 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.agent_needs_input")
					]
				}),
				/* @__PURE__ */ jsx("div", {
					className: "text-sm mt-1",
					children: campaign.pending_question || i18nT("apps.autoResearch.researchLabPage.the_agent_is_waiting_for_your_direction")
				}),
				/* @__PURE__ */ jsx("textarea", {
					"aria-label": i18nT("apps.autoResearch.researchLabPage.your_answer"),
					className: "w-full p-2 mt-2 rounded text-sm bg-bg border border-border resize-y",
					rows: 2,
					value: answerText,
					onChange: (e) => setAnswerText(e.target.value),
					placeholder: i18nT("apps.autoResearch.researchLabPage.your_answer_2")
				}),
				/* @__PURE__ */ jsx("div", {
					className: "flex gap-2 mt-2 justify-end",
					children: /* @__PURE__ */ jsx("button", {
						className: "text-xs px-2 py-1 rounded bg-accent text-accent-fg disabled:opacity-50",
						onClick: () => nudgeMut.mutate(answerText),
						disabled: !answerText || nudgeMut.isPending,
						children: nudgeMut.isPending ? i18nT("apps.autoResearch.researchLabPage.sending") : i18nT("apps.autoResearch.researchLabPage.answer_resume")
					})
				}),
				nudgeMut.isError && /* @__PURE__ */ jsx(ErrorNotice, {
					message: errMsg(nudgeMut.error),
					className: "mt-2"
				})
			]
		}),
		campaign.status === "failed" && /* @__PURE__ */ jsxs("div", {
			className: "mb-4 flex flex-col items-start gap-2",
			children: [/* @__PURE__ */ jsx(ErrorNotice, {
				title: i18nT("apps.autoResearch.researchLabPage.research_stopped"),
				message: `${campaign.error_message || i18nT("apps.autoResearch.researchLabPage.the_campaign_stopped_unexpectedly")} ${i18nT("apps.autoResearch.researchLabPage.findings_so_far_are_preserved_below")}`,
				askAgent: true,
				className: "w-full"
			}), /* @__PURE__ */ jsxs("button", {
				className: "text-xs px-2 py-1 rounded bg-accent text-accent-fg",
				onClick: () => actionMut.mutate("resume"),
				children: [
					/* @__PURE__ */ jsx(Play, {
						size: 12,
						className: "inline"
					}),
					" ",
					i18nT("apps.autoResearch.researchLabPage.resume")
				]
			})]
		}),
		(campaign.status === "complete" || campaign.status === "stopped") && !isActive && /* @__PURE__ */ jsxs("div", {
			className: "p-3 rounded-md mb-4 border border-accent bg-accent/5",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "text-sm font-medium flex items-center gap-1",
					children: [
						/* @__PURE__ */ jsx(GitFork, { size: 14 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.continue_research")
					]
				}),
				/* @__PURE__ */ jsx("div", {
					className: "text-xs mt-1 text-muted",
					children: i18nT("apps.autoResearch.researchLabPage.pick_up_where_this_campaign_left_off")
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex gap-2 mt-2 flex-wrap",
					children: [
						/* @__PURE__ */ jsxs("button", {
							className: "text-xs px-2 py-1 rounded bg-bg-elevated",
							onClick: () => onFork(id),
							children: [
								/* @__PURE__ */ jsx(GitFork, {
									size: 12,
									className: "inline"
								}),
								" ",
								i18nT("apps.autoResearch.researchLabPage.fork_challenge")
							]
						}),
						/* @__PURE__ */ jsx(AddToKnowledgeButton, { id }),
						/* @__PURE__ */ jsx(ExportArtifactButton, { id })
					]
				})
			]
		}),
		campaign.parent_id && /* @__PURE__ */ jsxs("div", {
			className: "text-xs text-muted mb-3",
			children: [
				i18nT("apps.autoResearch.researchLabPage.forked_from"),
				" ",
				/* @__PURE__ */ jsx("button", {
					className: "text-accent underline",
					onClick: () => onOpen(campaign.parent_id),
					children: campaign.parent_id
				})
			]
		}),
		/* @__PURE__ */ jsx(SubQuestionAdder, {
			id,
			campaign
		}),
		showNudge && /* @__PURE__ */ jsxs("div", {
			className: "p-3 rounded-md mb-4 border border-border bg-card",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "text-sm font-medium mb-2 flex items-center gap-1",
					children: [
						/* @__PURE__ */ jsx(MessageCircle, { size: 14 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.nudge_direction")
					]
				}),
				/* @__PURE__ */ jsx("textarea", {
					"aria-label": i18nT("apps.autoResearch.researchLabPage.nudge_direction_2"),
					className: "w-full p-2 rounded text-sm bg-bg border border-border resize-y",
					rows: 3,
					value: nudgeText,
					onChange: (e) => setNudgeText(e.target.value),
					placeholder: i18nT("apps.autoResearch.researchLabPage.focus_on")
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex gap-2 mt-2 justify-end",
					children: [/* @__PURE__ */ jsx("button", {
						className: "text-xs text-muted",
						onClick: () => setShowNudge(false),
						children: i18nT("apps.autoResearch.researchLabPage.cancel")
					}), /* @__PURE__ */ jsx("button", {
						className: "text-xs px-2 py-1 rounded bg-accent text-accent-fg disabled:opacity-50",
						onClick: () => nudgeMut.mutate(nudgeText),
						disabled: !nudgeText || nudgeMut.isPending,
						children: nudgeMut.isPending ? i18nT("apps.autoResearch.researchLabPage.sending") : i18nT("apps.autoResearch.researchLabPage.send")
					})]
				}),
				nudgeMut.isError && /* @__PURE__ */ jsx(ErrorNotice, {
					message: errMsg(nudgeMut.error),
					className: "mt-2"
				})
			]
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "mt-4",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center justify-between mb-2",
					children: [/* @__PURE__ */ jsx("div", {
						className: "text-sm font-medium",
						children: i18nT("apps.autoResearch.researchLabPage.findings_count", { count: findings.filter((f) => f.new_findings_count > 0).length })
					}), /* @__PURE__ */ jsx("button", {
						className: "text-xs px-2 py-1 rounded bg-bg-elevated",
						onClick: () => setShowReport((v) => !v),
						children: showReport ? i18nT("apps.autoResearch.researchLabPage.hide_report") : i18nT("apps.autoResearch.researchLabPage.view_report")
					})]
				}),
				showReport && /* @__PURE__ */ jsx("div", {
					className: "mb-3",
					children: reportData?.report ? /* @__PURE__ */ jsx(ReportSections, { report: reportData.report }) : /* @__PURE__ */ jsx("div", {
						className: "text-sm text-muted",
						children: i18nT("apps.autoResearch.researchLabPage.no_report_yet")
					})
				}),
				sorted.filter((f) => f.new_findings_count > 0 || f.cycle === 1).map((f) => /* @__PURE__ */ jsx(FindingCard, { f }, f.cycle)),
				findings.length === 0 && /* @__PURE__ */ jsx("div", {
					className: "text-sm text-muted",
					children: i18nT("apps.autoResearch.researchLabPage.first_cycle_in_progress")
				})
			]
		})
	] });
}
function ResearchLabPage() {
	const [view, setView] = useState("list");
	const [selectedId, setSelectedId] = useState(null);
	const [forkParentId, setForkParentId] = useState(null);
	const qc = useQueryClient();
	const { data: campaigns = [], isLoading } = useQuery({
		queryKey: ["research-campaigns"],
		queryFn: () => api.researchCampaigns(),
		refetchInterval: (query) => {
			return query.state.data?.some((c) => ACTIVE_STATUSES.includes(c.status)) ? 1e4 : false;
		}
	});
	const active = campaigns.find((c) => ACTIVE_STATUSES.includes(c.status));
	if (view === "wizard") return /* @__PURE__ */ jsxs("div", {
		className: "px-4 md:px-6 py-4",
		children: [/* @__PURE__ */ jsx("h1", {
			className: "text-lg font-semibold mb-4",
			children: i18nT("apps.autoResearch.researchLabPage.new_campaign")
		}), /* @__PURE__ */ jsx(SetupWizard, {
			onCancel: () => setView("list"),
			onDone: () => {
				qc.invalidateQueries({ queryKey: ["research-campaigns"] });
				setView("list");
			}
		})]
	});
	if (view === "fork" && forkParentId) return /* @__PURE__ */ jsxs("div", {
		className: "px-4 md:px-6 py-4",
		children: [/* @__PURE__ */ jsx("h1", {
			className: "text-lg font-semibold mb-4",
			children: i18nT("apps.autoResearch.researchLabPage.continue_research")
		}), /* @__PURE__ */ jsx(ForkFlow, {
			parentId: forkParentId,
			onCancel: () => setView("list"),
			onDone: () => {
				qc.invalidateQueries({ queryKey: ["research-campaigns"] });
				setView("list");
			}
		})]
	});
	if (view === "detail" && selectedId) return /* @__PURE__ */ jsx("div", {
		className: "px-4 md:px-6 py-4",
		children: /* @__PURE__ */ jsx(CampaignDetail, {
			id: selectedId,
			onBack: () => setView("list"),
			onFork: (id) => {
				setForkParentId(id);
				setView("fork");
			},
			onOpen: (pid) => setSelectedId(pid)
		})
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "px-4 md:px-6 py-4",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-between mb-4",
				children: [/* @__PURE__ */ jsxs("h1", {
					className: "text-lg font-semibold flex items-center gap-2",
					children: [
						/* @__PURE__ */ jsx(FlaskConical, { size: 20 }),
						" ",
						i18nT("apps.autoResearch.researchLabPage.research_lab")
					]
				}), /* @__PURE__ */ jsx("button", {
					className: "text-sm px-3 py-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-50",
					disabled: !!active,
					onClick: () => setView("wizard"),
					title: active ? i18nT("apps.autoResearch.researchLabPage.one_campaign_at_a_time") : "",
					children: i18nT("apps.autoResearch.researchLabPage.new_campaign_2")
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "text-xs text-muted mb-4 flex items-start gap-1",
				children: [
					/* @__PURE__ */ jsx(Lock, {
						size: 12,
						className: "mt-0.5 shrink-0"
					}),
					" ",
					/* @__PURE__ */ jsxs("span", { children: [
						/* @__PURE__ */ jsx("span", {
							className: "font-medium",
							children: i18nT("apps.autoResearch.researchLabPage.research_only")
						}),
						" ",
						i18nT("apps.autoResearch.researchLabPage.research_lab_investigates_and_reports_it_never_t")
					] })
				]
			}),
			isLoading ? /* @__PURE__ */ jsx("div", {
				className: "text-sm text-muted",
				children: i18nT("apps.autoResearch.researchLabPage.loading")
			}) : campaigns.length === 0 ? /* @__PURE__ */ jsxs("div", {
				className: "text-center py-12",
				children: [
					/* @__PURE__ */ jsx(FlaskConical, {
						size: 48,
						className: "mx-auto text-muted mb-3"
					}),
					/* @__PURE__ */ jsx("div", {
						className: "text-sm text-muted",
						children: i18nT("apps.autoResearch.researchLabPage.run_autonomous_research_campaigns")
					}),
					/* @__PURE__ */ jsx("button", {
						className: "mt-3 text-sm px-3 py-1.5 rounded-md bg-accent text-accent-fg",
						onClick: () => setView("wizard"),
						children: i18nT("apps.autoResearch.researchLabPage.new_campaign_2")
					})
				]
			}) : /* @__PURE__ */ jsxs("div", {
				className: "space-y-3",
				children: [
					active && /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
						className: "text-xs font-medium text-muted mb-1",
						children: i18nT("apps.autoResearch.researchLabPage.active")
					}), /* @__PURE__ */ jsxs(Clickable, {
						className: "border border-border rounded-md p-3 bg-card",
						onClick: () => {
							setSelectedId(active.id);
							setView("detail");
						},
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "flex items-start gap-2",
								children: [/* @__PURE__ */ jsx(StateBadge, { status: active.status }), /* @__PURE__ */ jsxs("div", {
									className: "font-medium text-sm line-clamp-2 flex-1",
									title: active.question,
									children: [active.parent_id && /* @__PURE__ */ jsxs("span", {
										className: "text-[10px] font-medium text-accent bg-accent-subtle rounded px-1 py-0.5 mr-1 inline-flex items-center gap-0.5 align-middle",
										children: [
											/* @__PURE__ */ jsx(GitFork, { size: 10 }),
											" ",
											i18nT("apps.autoResearch.researchLabPage.forked")
										]
									}), active.question]
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "text-xs text-muted mt-1 flex flex-wrap gap-x-3",
								children: [/* @__PURE__ */ jsxs("span", { children: [
									i18nT("apps.autoResearch.researchLabPage.cycle"),
									" ",
									active.total_cycles,
									"/",
									active.max_cycles
								] }), /* @__PURE__ */ jsx(ModelLine, { c: active })]
							}),
							/* @__PURE__ */ jsx(ModelWithheldNotice, {
								c: active,
								className: "mt-2"
							})
						]
					})] }),
					campaigns.filter((c) => !ACTIVE_STATUSES.includes(c.status)).length > 0 && /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
						className: "text-xs font-medium text-muted mb-1",
						children: i18nT("apps.autoResearch.researchLabPage.history")
					}), campaigns.filter((c) => !ACTIVE_STATUSES.includes(c.status)).map((c) => /* @__PURE__ */ jsxs(Clickable, {
						className: "border border-border rounded-md p-3 bg-card mb-2",
						onClick: () => {
							setSelectedId(c.id);
							setView("detail");
						},
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-start gap-2",
							children: [/* @__PURE__ */ jsx(StateBadge, { status: c.status }), /* @__PURE__ */ jsxs("div", {
								className: "text-sm line-clamp-2 flex-1",
								title: c.question,
								children: [c.parent_id && /* @__PURE__ */ jsxs("span", {
									className: "text-[10px] font-medium text-accent bg-accent-subtle rounded px-1 py-0.5 mr-1 inline-flex items-center gap-0.5 align-middle",
									children: [
										/* @__PURE__ */ jsx(GitFork, { size: 10 }),
										" ",
										i18nT("apps.autoResearch.researchLabPage.forked")
									]
								}), c.question]
							})]
						}), /* @__PURE__ */ jsxs("div", {
							className: "text-xs text-muted mt-1 flex flex-wrap gap-x-3",
							children: [/* @__PURE__ */ jsxs("span", { children: [
								c.total_cycles,
								" ",
								i18nT("apps.autoResearch.researchLabPage.cycles_2")
							] }), /* @__PURE__ */ jsx(ModelLine, { c })]
						})]
					}, c.id))] }),
					active && /* @__PURE__ */ jsxs("div", {
						className: "text-xs text-muted flex items-center gap-1",
						children: [
							/* @__PURE__ */ jsx(Lock, { size: 12 }),
							" ",
							i18nT("apps.autoResearch.researchLabPage.one_campaign_at_a_time_research_benefits_from_fo")
						]
					})
				]
			})
		]
	});
}
// src/index.tsx
/**
* The bundle's entry: AppHost lazy-imports this module and renders its default
* export as the app's page.
*
* Two things happen here once, for the whole page. The host's permission-scoped
* API client becomes the transport every Research Lab call goes through
* (`setTransport`), and the host's language generation is subscribed to, which
* repaints the page on a language switch: `t` reads the active locale at call
* time, and this component's re-render reaches every child.
*/
function ResearchLabApp() {
	useLanguageGeneration();
	setTransport(useAppApi());
	return /* @__PURE__ */ jsx(ResearchLabPage, {});
}
export { ResearchLabApp as default };
