export const PROMPT_CONSTANTS = {
  generatePromptForPicture: `You are an assistant that take a description and style and generate a prompt that will be used later to generate images, make it a very long and descriptive explanation, and write a lot of things for the renderer like, if it's realistic describe the camera`,
  generateVoiceFromText: `You are an assistant that takes a social media post and convert it to a normal human voice, to be later added to a character, when a person talk they don't use "-", and sometimes they add pause with "..." to make it sounds more natural, make sure you use a lot of pauses and make it sound like a real person`,
  generatePostsTwitter: 'Generate a Twitter post from the content without emojis in the following JSON format: { "post": string } put it in an array with one element',
  generatePostsThread: 'Generate a thread for social media in the following JSON format: Array<{ "post": string }> without emojis',
  extractWebsiteText: 'You take a full website text, and extract only the article content',
  separatePosts: (len: number) => `You are an assistant that take a social media post and break it to a thread, each post must be minimum ${len - 10} and maximum ${len} characters, keeping the exact wording and break lines, however make sure you split posts based on context`,
  separatePostShrink: (len: number) => `You are an assistant that take a social media post and shrink it to be maximum ${len} characters, keeping the exact wording and break lines`,
  generateSlidesFromText: `You are an assistant that takes a text and break it into slides, each slide should have an image prompt and voice text to be later used to generate a video and voice, image prompt should capture the essence of the slide and also have a back dark gradient on top, image prompt should not contain text in the picture, generate between 3-5 slides maximum`,
  generateHashtags: (platform: string) => `Generate 15-20 relevant hashtags for a social media post on ${platform}.
Return only a JSON object with a "hashtags" array of strings.
Include a mix of popular and niche hashtags. Do not include the "#" symbol in the output tags.`,
  generateAltText: 'You are an accessibility assistant. Generate alt-text that describes the image content for screen readers.',
  generateAltTextVisionPrompt: 'Generate a concise alt-text for this image (max 125 characters). Return only the alt-text.',
  generateAltTextFallbackPrompt: (imageRef: string) =>
    `Generate a concise alt-text for this image (max 125 characters). Image reference: ${imageRef}. Return only the alt-text.`,
  agentStartCall: (today: string) => `
    Today is ${today}, You are an assistant that gets a social media post or requests for a social media post.
    You research should be on the most possible recent data.
    You concat the text of the request together with an internet research based on the text.
    {text}
    `,
  agentFindCategory: `
        You are an assistant that gets a text that will be later summarized into a social media post
        and classify it to one of the following categories: {categories}
        text: {text}
      `,
  agentFindTopic: `
        You are an assistant that gets a text that will be later summarized into a social media post
        and classify it to one of the following topics: {topics}
        text: {text}
      `,
  agentGenerateHook: (tone: string, personMode: string) => `
        You are an assistant that gets content for a social media post, and generate only the hook.
        The hook is the 1-2 sentences of the post that will be used to grab the attention of the reader.
        You will be provided existing hooks you should use as inspiration.
        - Avoid weird hook that starts with "Discover the secret...", "The best...", "The most...", "The top..."
        - Make sure it sounds ${tone}
        - Use ${personMode} person mode
        - Make sure it's engaging
        - Don't be cringy
        - Use simple english
        - Make sure you add "\n" between the lines
        - Don't take the hook from "request of the user"

        <!-- BEGIN request of the user -->
        {request}
        <!-- END request of the user -->
        
        <!-- BEGIN existing hooks -->
        {hooks}
        <!-- END existing hooks -->
        
        <!-- BEGIN current content -->
        {text}
        <!-- END current content -->
       
      `,
  agentGenerateContent: (tone: string, personMode: string, lengthInstruction: string, countInstruction: string) => `
        You are an assistant that gets existing hook of a social media, content and generate only the content.
        - Don't add any hashtags
        - Make sure it sounds ${tone}
        - Use ${personMode} person mode
        - ${lengthInstruction}
        - ${countInstruction}
        - Use the hook as inspiration
        - Make sure it's engaging
        - Don't be cringy
        - Use simple english
        - The Content should not contain the hook
        - Try to put some call to action at the end of the post
        - Make sure you add "\n" between the lines
        - Add "\n" after every "."
        
        Hook:
        {hook}
        
        User request:
        {request}
        
        current content information:
        {information}
      `,
  checkCompliance: (content: string, platform?: string) => `
    You are a content compliance checker. Review the following social media post content for potential issues:
    - Platform Terms of Service violations
    - Brand safety concerns (hate speech, profanity, sensitive topics)
    - Regulatory compliance (FTC disclosure, copyright, trademark)
    - Community guideline violations
    - Competitor mentions or trademark issues

    Content to review: "${content}"
    ${platform ? `Target platform: ${platform}` : ''}

    Return a JSON object with:
    - "passed": boolean (true if no violations found)
    - "violations": array of objects with "type" (string), "severity" ("high"|"medium"|"low"), "description" (string)
    - "suggestions": array of strings with remediation suggestions
  `,
} as const;
