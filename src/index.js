/*
    Simple webhook for posting memes from Klei forums.

    Every time this file is executed, it will post the next meme from the configured forum thread
    remembering the page and comment index of the last one.
*/


const config = require("config")
const cheerio = require("cheerio")
const fs = require("fs")

//////////////////////////////

if (!config.has("discord_webhook_url")) {
    throw new Error("'discord_webhook_url' not configured! Add it to default.json or local.json files in the config folder.")
}

//////////////////////////////

const CACHE_FILE_PATH = "data/cache.json"

const INITIAL_PAGE_INDEX = 1 // Starts from 1!
const INITIAL_COMMENT_INDEX = 0

const UPVOTE_REACTION_NAME = "Haha"
const LIKE_REACTION_NAME = "Like"

const MAX_RETRY_ATTEMPTS = 50;

//////////////////////////////

if (!fs.existsSync(CACHE_FILE_PATH)) {
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify({
        page_index: INITIAL_PAGE_INDEX,
        comment_index: INITIAL_COMMENT_INDEX
    }))
}

const cache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH))
const attempt = {
    count: 0,
    pageIndex: cache.page_index,
    commentIndex: cache.comment_index,
}

//////////////////////////////

function getRandomColor() {
    // Generate a random color
    return Math.floor(Math.random() * 16777215); // 16777215 is 0xFFFFFF in decimal
}

function normalizeUrl(url) {
    return (url.startsWith("https://") | url.startsWith("http://")) ? url : "https://" + url.replace(/^[^a-zA-Z0-9]+/, "");
}

async function getPageMetadata(pageIndex) {
    if (cache.metadata && pageIndex == cache.page_index) {
        console.debug("Returning cached metadata...")
        return cache.metadata
    }

    const url = `${config.get("forum_post_url")}/page/${pageIndex}/`;
    console.debug("Fetching metadata from", url)
    const response = await fetch(url);
    const $ = cheerio.load(await response.text());

    const metadata = {comments: []}

    var commentsPerPage = 0;
    $("article").each(function (index) {
        commentsPerPage += 1;

        const comment_content = $(this).find("[data-role='commentContent']")
        const comment = {
            author: {
                name: $(this).find("span[id='cAuthorPane_author']").first().text(),
                url: normalizeUrl($(this).find("a.ipsUserPhoto").attr("href")),
                icon_url: normalizeUrl($(this).find("a.ipsUserPhoto ").find("img").attr("src"))
            },
            description: comment_content.find("p").text().trim(),
            timestamp: $(this).find("time").attr("datetime"),
        }

        // TODO: Possibly add support for citations?
        // const quote_content = $(this).find("div.ipsQuote_citation").text()
        // $(this).find("div.ipsQuote_citation").text("> " + quote_content);
        if ($(this).find("div.ipsQuote_citation").length > 0) {
            console.debug(index, "Skipping quote comment")
            return; // Ignore quote comments
        };

        const upvote_count = Number($(this).find("li.ipsReact_reactCount").find("[alt='" + UPVOTE_REACTION_NAME + "']").parent().parent().text().trim())
        const like_count = Number($(this).find("li.ipsReact_reactCount").find("[alt='" + LIKE_REACTION_NAME + "']").parent().parent().text().trim())
        if (upvote_count < config.get("minimum_upvote_count") && like_count < config.get("minimum_upvote_count") * 10) {
            console.debug(index, "Skipping comment with less than " + config.get("minimum_upvote_count") + " upvotes", upvote_count, like_count)
            return; // Ignore comments with less than 5 upvotes
        }

        const images = comment_content.find("img[src]")
        if (images.length <= 0 || images.length > 5) {
            return;
        }
        // if (images.length != 1) {
        //     console.debug(index, "Skipping comment with more than one image")
        //     return; // Ignore comments with more than one image (supports gifs as well)
        // }

        comment.index = metadata.comments.length;
        comment.page_index = pageIndex;
        comment.index_in_page = pageIndex == 1 ? index + 1 : index;
        comment.id = Number($(this).attr("id").split("_")[1]);
        comment.image = {
            url: normalizeUrl(images.first().attr("src")),
        }

        metadata.comments.push(comment);
    })

    cache.metadata = metadata
    cache.metadata.total_page_count = Number($("input[name='page']").attr("max"));
    cache.metadata.comments_per_page = commentsPerPage;

    cache.page_index = pageIndex

    return metadata;
}

async function getMemeCommentOnPage(pageIndex, commentIndex) {
    const metadata = await getPageMetadata(pageIndex)
    return metadata.comments[commentIndex]
}

async function attemptToGetMemeComment() {
    const comment = await getMemeCommentOnPage(attempt.pageIndex, attempt.commentIndex).catch(err => {
        console.error("Error while getting meme comment: ", err);
        return null;
    });

    if (!comment) {
        console.debug("Trying next page...");
        attempt.pageIndex += 1;
        attempt.commentIndex = INITIAL_COMMENT_INDEX;

        attempt.count += 1;
        if (attempt.count < MAX_RETRY_ATTEMPTS) {
            return attemptToGetMemeComment();
        }
    }

    return comment;
}

function postMemeComment(comment) {
    console.log("Posting a meme to discord!")

    cache.page_index = comment.page_index;
    cache.comment_index = comment.index + 1;

    const embed = structuredClone(comment);
    embed.color = getRandomColor();

    const sourceUrl = config.get("forum_post_url") + "/?do=findComment&comment=" + comment.id;
    const totalPostCount = cache.metadata.comments_per_page || "???";
    const totalPageCount = cache.metadata.total_page_count || "???";
    embed.footer = {
        text: "Page " + comment.page_index + " of " + totalPageCount + " | Comment " + (comment.index_in_page + 1) + " of " + totalPostCount,
    }

    const payload = {
        allowed_mentions: { parse: [] },
        embeds: [embed],
    };
    if (config.get("application_owned_webhook")) {
        payload.components = [{
            type: 1, // ActionRow
            components: [
                {
                    type: 2, // Button
                    label: "Zdroj",
                    style: 5, // Link Button
                    url: sourceUrl,
                }
            ]
        }]
    }

    fetch(config.get("discord_webhook_url"), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(response =>
        console.log("[" + response.status + "] " + response.statusText)
    );
}

//////////////////////////////

attemptToGetMemeComment()
    .then(comment => {
        if (comment) {
            postMemeComment(comment);
        } else {
            console.error("No comment found after multiple attempts!");
        }
    })
    .finally(function () { // Save the cache.
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache));
    });
