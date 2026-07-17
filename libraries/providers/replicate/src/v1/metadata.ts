import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "replicate",
  "displayName": "replicate",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-bg-remove",
    "image-inpaint",
    "image-slide",
    "image-to-image",
    "image-to-video",
    "image-upscale",
    "text-to-image",
    "text-to-music",
    "text-to-video",
    "video-background",
    "video-to-video",
    "video-upscale"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "black-forest-labs/flux-schnell",
        "label": "flux-schnell",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio for the generated image",
            "type": "select",
            "options": [
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "num_outputs",
            "label": "Num Outputs",
            "help": "Number of outputs to generate",
            "type": "number",
            "min": 1,
            "max": 4,
            "step": 1,
            "default": 1
          },
          {
            "name": "num_inference_steps",
            "label": "Num Inference Steps",
            "help": "Number of denoising steps. 4 is recommended, and lower number of steps produce lower quality outputs, faster.",
            "type": "number",
            "min": 1,
            "max": 4,
            "step": 1,
            "default": 4
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images",
            "type": "select",
            "options": [
              {
                "value": "webp",
                "label": "webp"
              },
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "webp"
          },
          {
            "name": "output_quality",
            "label": "Output Quality",
            "help": "Quality when saving the output images, from 0 to 100. 100 is best quality, 0 is lowest quality. Not relevant for .png outputs",
            "type": "number",
            "min": 0,
            "max": 100,
            "step": 1,
            "default": 80
          },
          {
            "name": "disable_safety_checker",
            "label": "Disable Safety Checker",
            "help": "Disable safety checker for generated images.",
            "type": "toggle",
            "default": false
          },
          {
            "name": "go_fast",
            "label": "Go Fast",
            "help": "Run faster predictions with model optimized for speed (currently fp8 quantized); disable to run in original bf16. Note that outputs will not be deterministic when this is enabled, even if you set a seed.",
            "type": "toggle",
            "default": true
          },
          {
            "name": "megapixels",
            "label": "megapixels",
            "help": "Approximate number of megapixels for generated image",
            "type": "select",
            "options": [
              {
                "value": "1",
                "label": "1"
              },
              {
                "value": "0.25",
                "label": "0.25"
              }
            ],
            "default": "1"
          }
        ]
      },
      {
        "id": "black-forest-labs/flux-dev",
        "label": "flux-dev",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio for the generated image",
            "type": "select",
            "options": [
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "prompt_strength",
            "label": "Prompt Strength",
            "help": "Prompt strength when using img2img. 1.0 corresponds to full destruction of information in image",
            "type": "number",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 0.8
          },
          {
            "name": "num_outputs",
            "label": "Num Outputs",
            "help": "Number of outputs to generate",
            "type": "number",
            "min": 1,
            "max": 4,
            "step": 1,
            "default": 1
          },
          {
            "name": "num_inference_steps",
            "label": "Num Inference Steps",
            "help": "Number of denoising steps. Recommended range is 28-50, and lower number of steps produce lower quality outputs, faster.",
            "type": "number",
            "min": 1,
            "max": 50,
            "step": 1,
            "default": 28
          },
          {
            "name": "guidance",
            "label": "Guidance",
            "help": "Guidance for generated image",
            "type": "number",
            "min": 0,
            "max": 10,
            "step": 0.1,
            "default": 3
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images",
            "type": "select",
            "options": [
              {
                "value": "webp",
                "label": "webp"
              },
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "webp"
          },
          {
            "name": "output_quality",
            "label": "Output Quality",
            "help": "Quality when saving the output images, from 0 to 100. 100 is best quality, 0 is lowest quality. Not relevant for .png outputs",
            "type": "number",
            "min": 0,
            "max": 100,
            "step": 1,
            "default": 80
          },
          {
            "name": "disable_safety_checker",
            "label": "Disable Safety Checker",
            "help": "Disable safety checker for generated images.",
            "type": "toggle",
            "default": false
          },
          {
            "name": "go_fast",
            "label": "Go Fast",
            "help": "Run faster predictions with model optimized for speed (currently fp8 quantized); disable to run in original bf16. Note that outputs will not be deterministic when this is enabled, even if you set a seed.",
            "type": "toggle",
            "default": true
          },
          {
            "name": "megapixels",
            "label": "megapixels",
            "help": "Approximate number of megapixels for generated image",
            "type": "select",
            "options": [
              {
                "value": "1",
                "label": "1"
              },
              {
                "value": "0.25",
                "label": "0.25"
              }
            ],
            "default": "1"
          }
        ]
      },
      {
        "id": "black-forest-labs/flux-1.1-pro",
        "label": "flux-1.1-pro",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio for the generated image",
            "type": "select",
            "options": [
              {
                "value": "custom",
                "label": "custom"
              },
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "4:3",
                "label": "4:3"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images.",
            "type": "select",
            "options": [
              {
                "value": "webp",
                "label": "webp"
              },
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "webp"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "width",
            "label": "Width",
            "help": "Width of the generated image in text-to-image mode. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32). Note: Ignored in img2img and inpainting modes.",
            "type": "number",
            "min": 256,
            "max": 1440,
            "step": 1
          },
          {
            "name": "height",
            "label": "Height",
            "help": "Height of the generated image in text-to-image mode. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32). Note: Ignored in img2img and inpainting modes.",
            "type": "number",
            "min": 256,
            "max": 1440,
            "step": 1
          },
          {
            "name": "output_quality",
            "label": "Output Quality",
            "help": "Quality when saving the output images, from 0 to 100. 100 is best quality, 0 is lowest quality. Not relevant for .png outputs",
            "type": "number",
            "min": 0,
            "max": 100,
            "step": 1,
            "default": 80
          },
          {
            "name": "safety_tolerance",
            "label": "Safety Tolerance",
            "help": "Safety tolerance, 1 is most strict and 6 is most permissive",
            "type": "number",
            "min": 1,
            "max": 6,
            "step": 1,
            "default": 2
          },
          {
            "name": "prompt_upsampling",
            "label": "Prompt Upsampling",
            "help": "Automatically modify the prompt for more creative generation",
            "type": "toggle",
            "default": false
          }
        ]
      },
      {
        "id": "google/imagen-4",
        "label": "imagen-4",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio of the generated image",
            "type": "select",
            "options": [
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "4:3",
                "label": "4:3"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "image_size",
            "label": "image_size",
            "help": "Resolution of the generated image",
            "type": "select",
            "options": [
              {
                "value": "1K",
                "label": "1K"
              },
              {
                "value": "2K",
                "label": "2K"
              }
            ],
            "default": "1K"
          },
          {
            "name": "safety_filter_level",
            "label": "safety_filter_level",
            "help": "block_low_and_above is strictest, block_medium_and_above blocks some prompts, block_only_high is most permissive but some prompts will still be blocked",
            "type": "select",
            "options": [
              {
                "value": "block_low_and_above",
                "label": "block_low_and_above"
              },
              {
                "value": "block_medium_and_above",
                "label": "block_medium_and_above"
              },
              {
                "value": "block_only_high",
                "label": "block_only_high"
              }
            ],
            "default": "block_only_high"
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output image",
            "type": "select",
            "options": [
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "jpg"
          }
        ]
      },
      {
        "id": "ideogram-ai/ideogram-v3-turbo",
        "label": "ideogram-v3-turbo",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio. Ignored if a resolution or inpainting image is given.",
            "type": "select",
            "options": [
              {
                "value": "1:3",
                "label": "1:3"
              },
              {
                "value": "3:1",
                "label": "3:1"
              },
              {
                "value": "1:2",
                "label": "1:2"
              },
              {
                "value": "2:1",
                "label": "2:1"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "10:16",
                "label": "10:16"
              },
              {
                "value": "16:10",
                "label": "16:10"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "1:1",
                "label": "1:1"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "resolution",
            "label": "resolution",
            "help": "Resolution. Overrides aspect ratio. Ignored if an inpainting image is given.",
            "type": "select",
            "options": [
              {
                "value": "None",
                "label": "None"
              },
              {
                "value": "512x1536",
                "label": "512x1536"
              },
              {
                "value": "576x1408",
                "label": "576x1408"
              },
              {
                "value": "576x1472",
                "label": "576x1472"
              },
              {
                "value": "576x1536",
                "label": "576x1536"
              },
              {
                "value": "640x1344",
                "label": "640x1344"
              },
              {
                "value": "640x1408",
                "label": "640x1408"
              },
              {
                "value": "640x1472",
                "label": "640x1472"
              },
              {
                "value": "640x1536",
                "label": "640x1536"
              },
              {
                "value": "704x1152",
                "label": "704x1152"
              },
              {
                "value": "704x1216",
                "label": "704x1216"
              },
              {
                "value": "704x1280",
                "label": "704x1280"
              },
              {
                "value": "704x1344",
                "label": "704x1344"
              },
              {
                "value": "704x1408",
                "label": "704x1408"
              },
              {
                "value": "704x1472",
                "label": "704x1472"
              },
              {
                "value": "736x1312",
                "label": "736x1312"
              },
              {
                "value": "768x1088",
                "label": "768x1088"
              },
              {
                "value": "768x1216",
                "label": "768x1216"
              },
              {
                "value": "768x1280",
                "label": "768x1280"
              },
              {
                "value": "768x1344",
                "label": "768x1344"
              },
              {
                "value": "800x1280",
                "label": "800x1280"
              },
              {
                "value": "832x960",
                "label": "832x960"
              },
              {
                "value": "832x1024",
                "label": "832x1024"
              },
              {
                "value": "832x1088",
                "label": "832x1088"
              },
              {
                "value": "832x1152",
                "label": "832x1152"
              },
              {
                "value": "832x1216",
                "label": "832x1216"
              },
              {
                "value": "832x1248",
                "label": "832x1248"
              },
              {
                "value": "864x1152",
                "label": "864x1152"
              },
              {
                "value": "896x960",
                "label": "896x960"
              },
              {
                "value": "896x1024",
                "label": "896x1024"
              },
              {
                "value": "896x1088",
                "label": "896x1088"
              },
              {
                "value": "896x1120",
                "label": "896x1120"
              },
              {
                "value": "896x1152",
                "label": "896x1152"
              },
              {
                "value": "960x832",
                "label": "960x832"
              },
              {
                "value": "960x896",
                "label": "960x896"
              },
              {
                "value": "960x1024",
                "label": "960x1024"
              },
              {
                "value": "960x1088",
                "label": "960x1088"
              },
              {
                "value": "1024x832",
                "label": "1024x832"
              },
              {
                "value": "1024x896",
                "label": "1024x896"
              },
              {
                "value": "1024x960",
                "label": "1024x960"
              },
              {
                "value": "1024x1024",
                "label": "1024x1024"
              },
              {
                "value": "1088x768",
                "label": "1088x768"
              },
              {
                "value": "1088x832",
                "label": "1088x832"
              },
              {
                "value": "1088x896",
                "label": "1088x896"
              },
              {
                "value": "1088x960",
                "label": "1088x960"
              },
              {
                "value": "1120x896",
                "label": "1120x896"
              },
              {
                "value": "1152x704",
                "label": "1152x704"
              },
              {
                "value": "1152x832",
                "label": "1152x832"
              },
              {
                "value": "1152x864",
                "label": "1152x864"
              },
              {
                "value": "1152x896",
                "label": "1152x896"
              },
              {
                "value": "1216x704",
                "label": "1216x704"
              },
              {
                "value": "1216x768",
                "label": "1216x768"
              },
              {
                "value": "1216x832",
                "label": "1216x832"
              },
              {
                "value": "1248x832",
                "label": "1248x832"
              },
              {
                "value": "1280x704",
                "label": "1280x704"
              },
              {
                "value": "1280x768",
                "label": "1280x768"
              },
              {
                "value": "1280x800",
                "label": "1280x800"
              },
              {
                "value": "1312x736",
                "label": "1312x736"
              },
              {
                "value": "1344x640",
                "label": "1344x640"
              },
              {
                "value": "1344x704",
                "label": "1344x704"
              },
              {
                "value": "1344x768",
                "label": "1344x768"
              },
              {
                "value": "1408x576",
                "label": "1408x576"
              },
              {
                "value": "1408x640",
                "label": "1408x640"
              },
              {
                "value": "1408x704",
                "label": "1408x704"
              },
              {
                "value": "1472x576",
                "label": "1472x576"
              },
              {
                "value": "1472x640",
                "label": "1472x640"
              },
              {
                "value": "1472x704",
                "label": "1472x704"
              },
              {
                "value": "1536x512",
                "label": "1536x512"
              },
              {
                "value": "1536x576",
                "label": "1536x576"
              },
              {
                "value": "1536x640",
                "label": "1536x640"
              }
            ],
            "default": "None"
          },
          {
            "name": "magic_prompt_option",
            "label": "magic_prompt_option",
            "help": "Magic Prompt will interpret your prompt and optimize it to maximize variety and quality of the images generated. You can also use it to write prompts in different languages.",
            "type": "select",
            "options": [
              {
                "value": "Auto",
                "label": "Auto"
              },
              {
                "value": "On",
                "label": "On"
              },
              {
                "value": "Off",
                "label": "Off"
              }
            ],
            "default": "Auto"
          },
          {
            "name": "style_type",
            "label": "style_type",
            "help": "The styles help define the specific aesthetic of the image you want to generate.",
            "type": "select",
            "options": [
              {
                "value": "None",
                "label": "None"
              },
              {
                "value": "Auto",
                "label": "Auto"
              },
              {
                "value": "General",
                "label": "General"
              },
              {
                "value": "Realistic",
                "label": "Realistic"
              },
              {
                "value": "Design",
                "label": "Design"
              }
            ],
            "default": "None"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "max": 2147483647,
            "step": 1
          },
          {
            "name": "style_preset",
            "label": "style_preset",
            "help": "Apply a predefined artistic style to the generated image (V3 models only).",
            "type": "select",
            "options": [
              {
                "value": "None",
                "label": "None"
              },
              {
                "value": "80s Illustration",
                "label": "80s Illustration"
              },
              {
                "value": "90s Nostalgia",
                "label": "90s Nostalgia"
              },
              {
                "value": "Abstract Organic",
                "label": "Abstract Organic"
              },
              {
                "value": "Analog Nostalgia",
                "label": "Analog Nostalgia"
              },
              {
                "value": "Art Brut",
                "label": "Art Brut"
              },
              {
                "value": "Art Deco",
                "label": "Art Deco"
              },
              {
                "value": "Art Poster",
                "label": "Art Poster"
              },
              {
                "value": "Aura",
                "label": "Aura"
              },
              {
                "value": "Avant Garde",
                "label": "Avant Garde"
              },
              {
                "value": "Bauhaus",
                "label": "Bauhaus"
              },
              {
                "value": "Blueprint",
                "label": "Blueprint"
              },
              {
                "value": "Blurry Motion",
                "label": "Blurry Motion"
              },
              {
                "value": "Bright Art",
                "label": "Bright Art"
              },
              {
                "value": "C4D Cartoon",
                "label": "C4D Cartoon"
              },
              {
                "value": "Children's Book",
                "label": "Children's Book"
              },
              {
                "value": "Collage",
                "label": "Collage"
              },
              {
                "value": "Coloring Book I",
                "label": "Coloring Book I"
              },
              {
                "value": "Coloring Book II",
                "label": "Coloring Book II"
              },
              {
                "value": "Cubism",
                "label": "Cubism"
              },
              {
                "value": "Dark Aura",
                "label": "Dark Aura"
              },
              {
                "value": "Doodle",
                "label": "Doodle"
              },
              {
                "value": "Double Exposure",
                "label": "Double Exposure"
              },
              {
                "value": "Dramatic Cinema",
                "label": "Dramatic Cinema"
              },
              {
                "value": "Editorial",
                "label": "Editorial"
              },
              {
                "value": "Emotional Minimal",
                "label": "Emotional Minimal"
              },
              {
                "value": "Ethereal Party",
                "label": "Ethereal Party"
              },
              {
                "value": "Expired Film",
                "label": "Expired Film"
              },
              {
                "value": "Flat Art",
                "label": "Flat Art"
              },
              {
                "value": "Flat Vector",
                "label": "Flat Vector"
              },
              {
                "value": "Forest Reverie",
                "label": "Forest Reverie"
              },
              {
                "value": "Geo Minimalist",
                "label": "Geo Minimalist"
              },
              {
                "value": "Glass Prism",
                "label": "Glass Prism"
              },
              {
                "value": "Golden Hour",
                "label": "Golden Hour"
              },
              {
                "value": "Graffiti I",
                "label": "Graffiti I"
              },
              {
                "value": "Graffiti II",
                "label": "Graffiti II"
              },
              {
                "value": "Halftone Print",
                "label": "Halftone Print"
              },
              {
                "value": "High Contrast",
                "label": "High Contrast"
              },
              {
                "value": "Hippie Era",
                "label": "Hippie Era"
              },
              {
                "value": "Iconic",
                "label": "Iconic"
              },
              {
                "value": "Japandi Fusion",
                "label": "Japandi Fusion"
              },
              {
                "value": "Jazzy",
                "label": "Jazzy"
              },
              {
                "value": "Long Exposure",
                "label": "Long Exposure"
              },
              {
                "value": "Magazine Editorial",
                "label": "Magazine Editorial"
              },
              {
                "value": "Minimal Illustration",
                "label": "Minimal Illustration"
              },
              {
                "value": "Mixed Media",
                "label": "Mixed Media"
              },
              {
                "value": "Monochrome",
                "label": "Monochrome"
              },
              {
                "value": "Nightlife",
                "label": "Nightlife"
              },
              {
                "value": "Oil Painting",
                "label": "Oil Painting"
              },
              {
                "value": "Old Cartoons",
                "label": "Old Cartoons"
              },
              {
                "value": "Paint Gesture",
                "label": "Paint Gesture"
              },
              {
                "value": "Pop Art",
                "label": "Pop Art"
              },
              {
                "value": "Retro Etching",
                "label": "Retro Etching"
              },
              {
                "value": "Riviera Pop",
                "label": "Riviera Pop"
              },
              {
                "value": "Spotlight 80s",
                "label": "Spotlight 80s"
              },
              {
                "value": "Stylized Red",
                "label": "Stylized Red"
              },
              {
                "value": "Surreal Collage",
                "label": "Surreal Collage"
              },
              {
                "value": "Travel Poster",
                "label": "Travel Poster"
              },
              {
                "value": "Vintage Geo",
                "label": "Vintage Geo"
              },
              {
                "value": "Vintage Poster",
                "label": "Vintage Poster"
              },
              {
                "value": "Watercolor",
                "label": "Watercolor"
              },
              {
                "value": "Weird",
                "label": "Weird"
              },
              {
                "value": "Woodblock Print",
                "label": "Woodblock Print"
              }
            ],
            "default": "None"
          }
        ]
      },
      {
        "id": "stability-ai/stable-diffusion-3.5-large",
        "label": "stable-diffusion-3.5-large",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "The aspect ratio of your output image. This value is ignored if you are using an input image.",
            "type": "select",
            "options": [
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images",
            "type": "select",
            "options": [
              {
                "value": "webp",
                "label": "webp"
              },
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "webp"
          },
          {
            "name": "cfg",
            "label": "Cfg",
            "help": "The guidance scale tells the model how similar the output should be to the prompt.",
            "type": "number",
            "min": 1,
            "max": 10,
            "step": 0.1,
            "default": 5
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Set a seed for reproducibility. Random by default.",
            "type": "number",
            "step": 1
          },
          {
            "name": "negative_prompt",
            "label": "Negative Prompt",
            "help": "What you do not want to see in the image",
            "type": "text"
          },
          {
            "name": "prompt_strength",
            "label": "Prompt Strength",
            "help": "Prompt strength (or denoising strength) when using image to image. 1.0 corresponds to full destruction of information in image.",
            "type": "number",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 0.85
          }
        ]
      }
    ],
    "image-to-image": [
      {
        "id": "black-forest-labs/flux-kontext-pro",
        "label": "flux-kontext-pro",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio of the generated image. Use 'match_input_image' to match the aspect ratio of the input image.",
            "type": "select",
            "options": [
              {
                "value": "match_input_image",
                "label": "match_input_image"
              },
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "9:21",
                "label": "9:21"
              },
              {
                "value": "2:1",
                "label": "2:1"
              },
              {
                "value": "1:2",
                "label": "1:2"
              }
            ],
            "default": "match_input_image"
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Output format for the generated image",
            "type": "select",
            "options": [
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "png"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "safety_tolerance",
            "label": "Safety Tolerance",
            "help": "Safety tolerance, 0 is most strict and 6 is most permissive. 2 is currently the maximum allowed when input images are used.",
            "type": "number",
            "min": 0,
            "max": 6,
            "step": 1,
            "default": 2
          },
          {
            "name": "prompt_upsampling",
            "label": "Prompt Upsampling",
            "help": "Automatic prompt improvement",
            "type": "toggle",
            "default": false
          }
        ]
      },
      {
        "id": "black-forest-labs/flux-dev",
        "label": "flux-dev",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Aspect ratio for the generated image",
            "type": "select",
            "options": [
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "3:2",
                "label": "3:2"
              },
              {
                "value": "2:3",
                "label": "2:3"
              },
              {
                "value": "4:5",
                "label": "4:5"
              },
              {
                "value": "5:4",
                "label": "5:4"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "1:1"
          },
          {
            "name": "prompt_strength",
            "label": "Prompt Strength",
            "help": "Prompt strength when using img2img. 1.0 corresponds to full destruction of information in image",
            "type": "number",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 0.8
          },
          {
            "name": "num_outputs",
            "label": "Num Outputs",
            "help": "Number of outputs to generate",
            "type": "number",
            "min": 1,
            "max": 4,
            "step": 1,
            "default": 1
          },
          {
            "name": "num_inference_steps",
            "label": "Num Inference Steps",
            "help": "Number of denoising steps. Recommended range is 28-50, and lower number of steps produce lower quality outputs, faster.",
            "type": "number",
            "min": 1,
            "max": 50,
            "step": 1,
            "default": 28
          },
          {
            "name": "guidance",
            "label": "Guidance",
            "help": "Guidance for generated image",
            "type": "number",
            "min": 0,
            "max": 10,
            "step": 0.1,
            "default": 3
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images",
            "type": "select",
            "options": [
              {
                "value": "webp",
                "label": "webp"
              },
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "webp"
          },
          {
            "name": "output_quality",
            "label": "Output Quality",
            "help": "Quality when saving the output images, from 0 to 100. 100 is best quality, 0 is lowest quality. Not relevant for .png outputs",
            "type": "number",
            "min": 0,
            "max": 100,
            "step": 1,
            "default": 80
          },
          {
            "name": "disable_safety_checker",
            "label": "Disable Safety Checker",
            "help": "Disable safety checker for generated images.",
            "type": "toggle",
            "default": false
          },
          {
            "name": "go_fast",
            "label": "Go Fast",
            "help": "Run faster predictions with model optimized for speed (currently fp8 quantized); disable to run in original bf16. Note that outputs will not be deterministic when this is enabled, even if you set a seed.",
            "type": "toggle",
            "default": true
          },
          {
            "name": "megapixels",
            "label": "megapixels",
            "help": "Approximate number of megapixels for generated image",
            "type": "select",
            "options": [
              {
                "value": "1",
                "label": "1"
              },
              {
                "value": "0.25",
                "label": "0.25"
              }
            ],
            "default": "1"
          }
        ]
      }
    ],
    "image-bg-remove": [
      {
        "id": "bria/remove-background",
        "label": "remove-background",
        "fields": [
          {
            "name": "image_url",
            "label": "Image Url",
            "help": "Image URL",
            "type": "text"
          },
          {
            "name": "preserve_alpha",
            "label": "Preserve Alpha",
            "help": "Preserve alpha channel in output. When true, maintains original transparency. When false, output is fully opaque.",
            "type": "toggle",
            "default": true
          },
          {
            "name": "content_moderation",
            "label": "Content Moderation",
            "help": "Enable content moderation",
            "type": "toggle",
            "default": false
          },
          {
            "name": "preserve_partial_alpha",
            "label": "Preserve Partial Alpha",
            "help": "[DEPRECATED] Preserve partial alpha. No longer used in V2 API - use preserve_alpha instead.",
            "type": "toggle",
            "default": true
          }
        ]
      },
      {
        "id": "851-labs/background-remover",
        "label": "background-remover",
        "fields": [
          {
            "name": "threshold",
            "label": "Threshold",
            "help": "Threshold for hard segmentation (0.0-1.0). If 0.0, uses soft alpha.",
            "type": "number",
            "step": 0.1,
            "default": 0
          },
          {
            "name": "reverse",
            "label": "Reverse",
            "help": "If True, remove the foreground instead of the background.",
            "type": "toggle",
            "default": false
          },
          {
            "name": "background_type",
            "label": "Background Type",
            "help": "Background type: 'rgba', 'map', 'green', 'white', [R,G,B] array, 'blur', 'overlay', or path to an image.",
            "type": "text",
            "default": "rgba"
          },
          {
            "name": "format",
            "label": "Format",
            "help": "Output format (e.g., png, jpg). Defaults to png.",
            "type": "text",
            "default": "png"
          }
        ]
      }
    ],
    "image-upscale": [
      {
        "id": "recraft-ai/recraft-crisp-upscale",
        "label": "recraft-crisp-upscale",
        "fields": []
      },
      {
        "id": "nightmareai/real-esrgan",
        "label": "real-esrgan",
        "fields": [
          {
            "name": "scale",
            "label": "Scale",
            "help": "Factor to scale image by",
            "type": "number",
            "min": 0,
            "max": 10,
            "step": 0.1,
            "default": 4
          },
          {
            "name": "face_enhance",
            "label": "Face Enhance",
            "help": "Run GFPGAN face enhancement along with upscaling",
            "type": "toggle",
            "default": false
          }
        ]
      },
      {
        "id": "philz1337x/clarity-upscaler",
        "label": "clarity-upscaler",
        "fields": [
          {
            "name": "negative_prompt",
            "label": "Negative Prompt",
            "help": "Negative Prompt",
            "type": "text",
            "default": "(worst quality, low quality, normal quality:2) JuggernautNegative-neg"
          },
          {
            "name": "scale_factor",
            "label": "Scale Factor",
            "help": "Scale factor",
            "type": "number",
            "step": 0.1,
            "default": 2
          },
          {
            "name": "dynamic",
            "label": "Dynamic",
            "help": "HDR, try from 3 - 9",
            "type": "number",
            "min": 1,
            "max": 50,
            "step": 0.1,
            "default": 6
          },
          {
            "name": "creativity",
            "label": "Creativity",
            "help": "Creativity, try from 0.3 - 0.9",
            "type": "number",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 0.35
          },
          {
            "name": "resemblance",
            "label": "Resemblance",
            "help": "Resemblance, try from 0.3 - 1.6",
            "type": "number",
            "min": 0,
            "max": 3,
            "step": 0.1,
            "default": 0.6
          },
          {
            "name": "tiling_width",
            "label": "tiling_width",
            "help": "Fractality, set lower tile width for a high Fractality",
            "type": "select",
            "options": [
              {
                "value": "16",
                "label": "16"
              },
              {
                "value": "32",
                "label": "32"
              },
              {
                "value": "48",
                "label": "48"
              },
              {
                "value": "64",
                "label": "64"
              },
              {
                "value": "80",
                "label": "80"
              },
              {
                "value": "96",
                "label": "96"
              },
              {
                "value": "112",
                "label": "112"
              },
              {
                "value": "128",
                "label": "128"
              },
              {
                "value": "144",
                "label": "144"
              },
              {
                "value": "160",
                "label": "160"
              },
              {
                "value": "176",
                "label": "176"
              },
              {
                "value": "192",
                "label": "192"
              },
              {
                "value": "208",
                "label": "208"
              },
              {
                "value": "224",
                "label": "224"
              },
              {
                "value": "240",
                "label": "240"
              },
              {
                "value": "256",
                "label": "256"
              }
            ],
            "default": "112"
          },
          {
            "name": "tiling_height",
            "label": "tiling_height",
            "help": "Fractality, set lower tile height for a high Fractality",
            "type": "select",
            "options": [
              {
                "value": "16",
                "label": "16"
              },
              {
                "value": "32",
                "label": "32"
              },
              {
                "value": "48",
                "label": "48"
              },
              {
                "value": "64",
                "label": "64"
              },
              {
                "value": "80",
                "label": "80"
              },
              {
                "value": "96",
                "label": "96"
              },
              {
                "value": "112",
                "label": "112"
              },
              {
                "value": "128",
                "label": "128"
              },
              {
                "value": "144",
                "label": "144"
              },
              {
                "value": "160",
                "label": "160"
              },
              {
                "value": "176",
                "label": "176"
              },
              {
                "value": "192",
                "label": "192"
              },
              {
                "value": "208",
                "label": "208"
              },
              {
                "value": "224",
                "label": "224"
              },
              {
                "value": "240",
                "label": "240"
              },
              {
                "value": "256",
                "label": "256"
              }
            ],
            "default": "144"
          },
          {
            "name": "sd_model",
            "label": "sd_model",
            "help": "Stable Diffusion model checkpoint",
            "type": "select",
            "options": [
              {
                "value": "epicrealism_naturalSinRC1VAE.safetensors [84d76a0328]",
                "label": "epicrealism_naturalSinRC1VAE.safetensors [84d76a0328]"
              },
              {
                "value": "juggernaut_reborn.safetensors [338b85bc4f]",
                "label": "juggernaut_reborn.safetensors [338b85bc4f]"
              },
              {
                "value": "flat2DAnimerge_v45Sharp.safetensors",
                "label": "flat2DAnimerge_v45Sharp.safetensors"
              }
            ],
            "default": "juggernaut_reborn.safetensors [338b85bc4f]"
          },
          {
            "name": "scheduler",
            "label": "scheduler",
            "help": "scheduler",
            "type": "select",
            "options": [
              {
                "value": "DPM++ 2M Karras",
                "label": "DPM++ 2M Karras"
              },
              {
                "value": "DPM++ SDE Karras",
                "label": "DPM++ SDE Karras"
              },
              {
                "value": "DPM++ 2M SDE Exponential",
                "label": "DPM++ 2M SDE Exponential"
              },
              {
                "value": "DPM++ 2M SDE Karras",
                "label": "DPM++ 2M SDE Karras"
              },
              {
                "value": "Euler a",
                "label": "Euler a"
              },
              {
                "value": "Euler",
                "label": "Euler"
              },
              {
                "value": "LMS",
                "label": "LMS"
              },
              {
                "value": "Heun",
                "label": "Heun"
              },
              {
                "value": "DPM2",
                "label": "DPM2"
              },
              {
                "value": "DPM2 a",
                "label": "DPM2 a"
              },
              {
                "value": "DPM++ 2S a",
                "label": "DPM++ 2S a"
              },
              {
                "value": "DPM++ 2M",
                "label": "DPM++ 2M"
              },
              {
                "value": "DPM++ SDE",
                "label": "DPM++ SDE"
              },
              {
                "value": "DPM++ 2M SDE",
                "label": "DPM++ 2M SDE"
              },
              {
                "value": "DPM++ 2M SDE Heun",
                "label": "DPM++ 2M SDE Heun"
              },
              {
                "value": "DPM++ 2M SDE Heun Karras",
                "label": "DPM++ 2M SDE Heun Karras"
              },
              {
                "value": "DPM++ 2M SDE Heun Exponential",
                "label": "DPM++ 2M SDE Heun Exponential"
              },
              {
                "value": "DPM++ 3M SDE",
                "label": "DPM++ 3M SDE"
              },
              {
                "value": "DPM++ 3M SDE Karras",
                "label": "DPM++ 3M SDE Karras"
              },
              {
                "value": "DPM++ 3M SDE Exponential",
                "label": "DPM++ 3M SDE Exponential"
              },
              {
                "value": "DPM fast",
                "label": "DPM fast"
              },
              {
                "value": "DPM adaptive",
                "label": "DPM adaptive"
              },
              {
                "value": "LMS Karras",
                "label": "LMS Karras"
              },
              {
                "value": "DPM2 Karras",
                "label": "DPM2 Karras"
              },
              {
                "value": "DPM2 a Karras",
                "label": "DPM2 a Karras"
              },
              {
                "value": "DPM++ 2S a Karras",
                "label": "DPM++ 2S a Karras"
              },
              {
                "value": "Restart",
                "label": "Restart"
              },
              {
                "value": "DDIM",
                "label": "DDIM"
              },
              {
                "value": "PLMS",
                "label": "PLMS"
              },
              {
                "value": "UniPC",
                "label": "UniPC"
              }
            ],
            "default": "DPM++ 3M SDE Karras"
          },
          {
            "name": "num_inference_steps",
            "label": "Num Inference Steps",
            "help": "Number of denoising steps",
            "type": "number",
            "min": 1,
            "max": 100,
            "step": 1,
            "default": 18
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Leave blank to randomize the seed",
            "type": "number",
            "step": 1,
            "default": 1337
          },
          {
            "name": "downscaling",
            "label": "Downscaling",
            "help": "Downscale the image before upscaling. Can improve quality and speed for images with high resolution but lower quality",
            "type": "toggle",
            "default": false
          },
          {
            "name": "downscaling_resolution",
            "label": "Downscaling Resolution",
            "help": "Downscaling resolution",
            "type": "number",
            "step": 1,
            "default": 768
          },
          {
            "name": "lora_links",
            "label": "Lora Links",
            "help": "Link to a lora file you want to use in your upscaling. Multiple links possible, seperated by comma",
            "type": "text",
            "default": ""
          },
          {
            "name": "custom_sd_model",
            "label": "Custom Sd Model",
            "type": "text",
            "default": ""
          },
          {
            "name": "sharpen",
            "label": "Sharpen",
            "help": "Sharpen the image after upscaling. The higher the value, the more sharpening is applied. 0 for no sharpening",
            "type": "number",
            "min": 0,
            "max": 10,
            "step": 0.1,
            "default": 0
          },
          {
            "name": "handfix",
            "label": "handfix",
            "help": "Use clarity to fix hands in the image",
            "type": "select",
            "options": [
              {
                "value": "disabled",
                "label": "disabled"
              },
              {
                "value": "hands_only",
                "label": "hands_only"
              },
              {
                "value": "image_and_hands",
                "label": "image_and_hands"
              }
            ],
            "default": "disabled"
          },
          {
            "name": "pattern",
            "label": "Pattern",
            "help": "Upscale a pattern with seamless tiling",
            "type": "toggle",
            "default": false
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images",
            "type": "select",
            "options": [
              {
                "value": "webp",
                "label": "webp"
              },
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "png"
          }
        ]
      }
    ],
    "image-inpaint": [
      {
        "id": "black-forest-labs/flux-fill-pro",
        "label": "flux-fill-pro",
        "fields": [
          {
            "name": "outpaint",
            "label": "outpaint",
            "help": "A quick option for outpainting an input image. Mask will be ignored.",
            "type": "select",
            "options": [
              {
                "value": "None",
                "label": "None"
              },
              {
                "value": "Zoom out 1.5x",
                "label": "Zoom out 1.5x"
              },
              {
                "value": "Zoom out 2x",
                "label": "Zoom out 2x"
              },
              {
                "value": "Make square",
                "label": "Make square"
              },
              {
                "value": "Left outpaint",
                "label": "Left outpaint"
              },
              {
                "value": "Right outpaint",
                "label": "Right outpaint"
              },
              {
                "value": "Top outpaint",
                "label": "Top outpaint"
              },
              {
                "value": "Bottom outpaint",
                "label": "Bottom outpaint"
              }
            ],
            "default": "None"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "steps",
            "label": "Steps",
            "help": "Number of diffusion steps. Higher values yield finer details but increase processing time.",
            "type": "number",
            "min": 15,
            "max": 50,
            "step": 1,
            "default": 50
          },
          {
            "name": "prompt_upsampling",
            "label": "Prompt Upsampling",
            "help": "Automatically modify the prompt for more creative generation",
            "type": "toggle",
            "default": false
          },
          {
            "name": "guidance",
            "label": "Guidance",
            "help": "Controls the balance between adherence to the text prompt and image quality/diversity. Higher values make the output more closely match the prompt but may reduce overall image quality. Lower values allow for more creative freedom but might produce results less relevant to the prompt.",
            "type": "number",
            "min": 1.5,
            "max": 100,
            "step": 0.1,
            "default": 60
          },
          {
            "name": "safety_tolerance",
            "label": "Safety Tolerance",
            "help": "Safety tolerance, 1 is most strict and 6 is most permissive",
            "type": "number",
            "min": 1,
            "max": 6,
            "step": 1,
            "default": 2
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Format of the output images.",
            "type": "select",
            "options": [
              {
                "value": "jpg",
                "label": "jpg"
              },
              {
                "value": "png",
                "label": "png"
              }
            ],
            "default": "jpg"
          }
        ]
      },
      {
        "id": "stability-ai/stable-diffusion-inpainting",
        "label": "stable-diffusion-inpainting",
        "fields": [
          {
            "name": "height",
            "label": "height",
            "help": "Height of generated image in pixels. Needs to be a multiple of 64",
            "type": "select",
            "options": [
              {
                "value": "64",
                "label": "64"
              },
              {
                "value": "128",
                "label": "128"
              },
              {
                "value": "192",
                "label": "192"
              },
              {
                "value": "256",
                "label": "256"
              },
              {
                "value": "320",
                "label": "320"
              },
              {
                "value": "384",
                "label": "384"
              },
              {
                "value": "448",
                "label": "448"
              },
              {
                "value": "512",
                "label": "512"
              },
              {
                "value": "576",
                "label": "576"
              },
              {
                "value": "640",
                "label": "640"
              },
              {
                "value": "704",
                "label": "704"
              },
              {
                "value": "768",
                "label": "768"
              },
              {
                "value": "832",
                "label": "832"
              },
              {
                "value": "896",
                "label": "896"
              },
              {
                "value": "960",
                "label": "960"
              },
              {
                "value": "1024",
                "label": "1024"
              }
            ],
            "default": "512"
          },
          {
            "name": "width",
            "label": "width",
            "help": "Width of generated image in pixels. Needs to be a multiple of 64",
            "type": "select",
            "options": [
              {
                "value": "64",
                "label": "64"
              },
              {
                "value": "128",
                "label": "128"
              },
              {
                "value": "192",
                "label": "192"
              },
              {
                "value": "256",
                "label": "256"
              },
              {
                "value": "320",
                "label": "320"
              },
              {
                "value": "384",
                "label": "384"
              },
              {
                "value": "448",
                "label": "448"
              },
              {
                "value": "512",
                "label": "512"
              },
              {
                "value": "576",
                "label": "576"
              },
              {
                "value": "640",
                "label": "640"
              },
              {
                "value": "704",
                "label": "704"
              },
              {
                "value": "768",
                "label": "768"
              },
              {
                "value": "832",
                "label": "832"
              },
              {
                "value": "896",
                "label": "896"
              },
              {
                "value": "960",
                "label": "960"
              },
              {
                "value": "1024",
                "label": "1024"
              }
            ],
            "default": "512"
          },
          {
            "name": "negative_prompt",
            "label": "Negative Prompt",
            "help": "Specify things to not see in the output",
            "type": "text"
          },
          {
            "name": "num_outputs",
            "label": "Num Outputs",
            "help": "Number of images to generate.",
            "type": "number",
            "min": 1,
            "max": 4,
            "step": 1,
            "default": 1
          },
          {
            "name": "num_inference_steps",
            "label": "Num Inference Steps",
            "help": "Number of denoising steps",
            "type": "number",
            "min": 1,
            "max": 500,
            "step": 1,
            "default": 50
          },
          {
            "name": "guidance_scale",
            "label": "Guidance Scale",
            "help": "Scale for classifier-free guidance",
            "type": "number",
            "min": 1,
            "max": 20,
            "step": 0.1,
            "default": 7.5
          },
          {
            "name": "scheduler",
            "label": "scheduler",
            "help": "Choose a scheduler.",
            "type": "select",
            "options": [
              {
                "value": "DDIM",
                "label": "DDIM"
              },
              {
                "value": "K_EULER",
                "label": "K_EULER"
              },
              {
                "value": "DPMSolverMultistep",
                "label": "DPMSolverMultistep"
              },
              {
                "value": "K_EULER_ANCESTRAL",
                "label": "K_EULER_ANCESTRAL"
              },
              {
                "value": "PNDM",
                "label": "PNDM"
              },
              {
                "value": "KLMS",
                "label": "KLMS"
              }
            ],
            "default": "DPMSolverMultistep"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Leave blank to randomize the seed",
            "type": "number",
            "step": 1
          },
          {
            "name": "disable_safety_checker",
            "label": "Disable Safety Checker",
            "help": "Disable safety checker for generated images. This feature is only available through the API. See [https://replicate.com/docs/how-does-replicate-work#safety](https://replicate.com/docs/how-does-replicate-work#safety)",
            "type": "toggle",
            "default": false
          }
        ]
      }
    ],
    "text-to-video": [
      {
        "id": "google/veo-3",
        "label": "veo-3",
        "fields": [
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Video aspect ratio",
            "type": "select",
            "options": [
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "9:16",
                "label": "9:16"
              }
            ],
            "default": "16:9"
          },
          {
            "name": "duration",
            "label": "duration",
            "help": "Video duration in seconds",
            "type": "select",
            "options": [
              {
                "value": "4",
                "label": "4"
              },
              {
                "value": "6",
                "label": "6"
              },
              {
                "value": "8",
                "label": "8"
              }
            ],
            "default": "8"
          },
          {
            "name": "negative_prompt",
            "label": "Negative Prompt",
            "help": "Description of what to exclude from the generated video",
            "type": "text"
          },
          {
            "name": "resolution",
            "label": "resolution",
            "help": "Resolution of the generated video",
            "type": "select",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "default": "1080p"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Omit for random generations",
            "type": "number",
            "step": 1
          }
        ]
      },
      {
        "id": "minimax/video-01",
        "label": "video-01",
        "fields": [
          {
            "name": "prompt_optimizer",
            "label": "Prompt Optimizer",
            "help": "Use prompt optimizer",
            "type": "toggle",
            "default": true
          }
        ]
      },
      {
        "id": "bytedance/seedance-1-pro",
        "label": "seedance-1-pro",
        "fields": [
          {
            "name": "resolution",
            "label": "resolution",
            "help": "Video resolution",
            "type": "select",
            "options": [
              {
                "value": "480p",
                "label": "480p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "default": "1080p"
          },
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Video aspect ratio. Ignored if an image is used.",
            "type": "select",
            "options": [
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "16:9"
          },
          {
            "name": "fps",
            "label": "fps",
            "help": "Frame rate (frames per second)",
            "type": "select",
            "options": [
              {
                "value": "24",
                "label": "24"
              }
            ],
            "default": "24"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "duration",
            "label": "Duration",
            "help": "Video duration in seconds",
            "type": "number",
            "min": 2,
            "max": 12,
            "step": 1,
            "default": 5
          },
          {
            "name": "camera_fixed",
            "label": "Camera Fixed",
            "help": "Whether to fix camera position",
            "type": "toggle",
            "default": false
          }
        ]
      },
      {
        "id": "kwaivgi/kling-v2.1",
        "label": "kling-v2.1",
        "fields": [
          {
            "name": "mode",
            "label": "mode",
            "help": "Standard has a resolution of 720p, pro is 1080p. Both are 24fps.",
            "type": "select",
            "options": [
              {
                "value": "standard",
                "label": "standard"
              },
              {
                "value": "pro",
                "label": "pro"
              }
            ],
            "default": "standard"
          },
          {
            "name": "duration",
            "label": "duration",
            "help": "Duration of the video in seconds",
            "type": "select",
            "options": [
              {
                "value": "5",
                "label": "5"
              },
              {
                "value": "10",
                "label": "10"
              }
            ],
            "default": "5"
          },
          {
            "name": "negative_prompt",
            "label": "Negative Prompt",
            "help": "Things you do not want to see in the video",
            "type": "text",
            "default": ""
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "minimax/video-01",
        "label": "video-01",
        "fields": [
          {
            "name": "prompt_optimizer",
            "label": "Prompt Optimizer",
            "help": "Use prompt optimizer",
            "type": "toggle",
            "default": true
          }
        ]
      },
      {
        "id": "bytedance/seedance-1-pro",
        "label": "seedance-1-pro",
        "fields": [
          {
            "name": "resolution",
            "label": "resolution",
            "help": "Video resolution",
            "type": "select",
            "options": [
              {
                "value": "480p",
                "label": "480p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "default": "1080p"
          },
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Video aspect ratio. Ignored if an image is used.",
            "type": "select",
            "options": [
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "16:9"
          },
          {
            "name": "fps",
            "label": "fps",
            "help": "Frame rate (frames per second)",
            "type": "select",
            "options": [
              {
                "value": "24",
                "label": "24"
              }
            ],
            "default": "24"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "duration",
            "label": "Duration",
            "help": "Video duration in seconds",
            "type": "number",
            "min": 2,
            "max": 12,
            "step": 1,
            "default": 5
          },
          {
            "name": "camera_fixed",
            "label": "Camera Fixed",
            "help": "Whether to fix camera position",
            "type": "toggle",
            "default": false
          }
        ]
      },
      {
        "id": "kwaivgi/kling-v2.1",
        "label": "kling-v2.1",
        "fields": [
          {
            "name": "mode",
            "label": "mode",
            "help": "Standard has a resolution of 720p, pro is 1080p. Both are 24fps.",
            "type": "select",
            "options": [
              {
                "value": "standard",
                "label": "standard"
              },
              {
                "value": "pro",
                "label": "pro"
              }
            ],
            "default": "standard"
          },
          {
            "name": "duration",
            "label": "duration",
            "help": "Duration of the video in seconds",
            "type": "select",
            "options": [
              {
                "value": "5",
                "label": "5"
              },
              {
                "value": "10",
                "label": "10"
              }
            ],
            "default": "5"
          },
          {
            "name": "negative_prompt",
            "label": "Negative Prompt",
            "help": "Things you do not want to see in the video",
            "type": "text",
            "default": ""
          }
        ]
      }
    ],
    "video-to-video": [
      {
        "id": "bytedance/seedance-1-pro",
        "label": "seedance-1-pro",
        "fields": [
          {
            "name": "resolution",
            "label": "resolution",
            "help": "Video resolution",
            "type": "select",
            "options": [
              {
                "value": "480p",
                "label": "480p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "default": "1080p"
          },
          {
            "name": "aspect_ratio",
            "label": "aspect_ratio",
            "help": "Video aspect ratio. Ignored if an image is used.",
            "type": "select",
            "options": [
              {
                "value": "16:9",
                "label": "16:9"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "1:1",
                "label": "1:1"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "9:16",
                "label": "9:16"
              },
              {
                "value": "21:9",
                "label": "21:9"
              },
              {
                "value": "9:21",
                "label": "9:21"
              }
            ],
            "default": "16:9"
          },
          {
            "name": "fps",
            "label": "fps",
            "help": "Frame rate (frames per second)",
            "type": "select",
            "options": [
              {
                "value": "24",
                "label": "24"
              }
            ],
            "default": "24"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Random seed. Set for reproducible generation",
            "type": "number",
            "step": 1
          },
          {
            "name": "duration",
            "label": "Duration",
            "help": "Video duration in seconds",
            "type": "number",
            "min": 2,
            "max": 12,
            "step": 1,
            "default": 5
          },
          {
            "name": "camera_fixed",
            "label": "Camera Fixed",
            "help": "Whether to fix camera position",
            "type": "toggle",
            "default": false
          }
        ]
      }
    ],
    "video-upscale": [
      {
        "id": "topazlabs/video-upscale",
        "label": "video-upscale",
        "fields": [
          {
            "name": "target_resolution",
            "label": "target_resolution",
            "help": "Target resolution",
            "type": "select",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              },
              {
                "value": "4k",
                "label": "4k"
              }
            ],
            "default": "1080p"
          },
          {
            "name": "target_fps",
            "label": "Target Fps",
            "help": "Target FPS (choose from 15fps to 120fps)",
            "type": "number",
            "min": 15,
            "max": 120,
            "step": 1,
            "default": 60
          }
        ]
      },
      {
        "id": "lucataco/real-esrgan-video",
        "label": "real-esrgan-video",
        "fields": [
          {
            "name": "resolution",
            "label": "resolution",
            "help": "Output resolution",
            "type": "select",
            "options": [
              {
                "value": "FHD",
                "label": "FHD"
              },
              {
                "value": "2k",
                "label": "2k"
              },
              {
                "value": "4k",
                "label": "4k"
              }
            ],
            "default": "FHD"
          },
          {
            "name": "model",
            "label": "model",
            "help": "Upscaling model",
            "type": "select",
            "options": [
              {
                "value": "RealESRGAN_x4plus",
                "label": "RealESRGAN_x4plus"
              },
              {
                "value": "RealESRGAN_x4plus_anime_6B",
                "label": "RealESRGAN_x4plus_anime_6B"
              },
              {
                "value": "realesr-animevideov3",
                "label": "realesr-animevideov3"
              }
            ],
            "default": "RealESRGAN_x4plus"
          }
        ]
      }
    ],
    "video-background": [
      {
        "id": "arielreplicate/robust_video_matting",
        "label": "robust_video_matting",
        "fields": [
          {
            "name": "output_type",
            "label": "output_type",
            "help": "An enumeration.",
            "type": "select",
            "options": [
              {
                "value": "green-screen",
                "label": "green-screen"
              },
              {
                "value": "alpha-mask",
                "label": "alpha-mask"
              },
              {
                "value": "foreground-mask",
                "label": "foreground-mask"
              }
            ],
            "default": "green-screen"
          }
        ]
      }
    ],
    "text-to-music": [
      {
        "id": "meta/musicgen",
        "label": "musicgen",
        "fields": [
          {
            "name": "model_version",
            "label": "model_version",
            "help": "Model to use for generation",
            "type": "select",
            "options": [
              {
                "value": "stereo-melody-large",
                "label": "stereo-melody-large"
              },
              {
                "value": "stereo-large",
                "label": "stereo-large"
              },
              {
                "value": "melody-large",
                "label": "melody-large"
              },
              {
                "value": "large",
                "label": "large"
              }
            ],
            "default": "stereo-melody-large"
          },
          {
            "name": "duration",
            "label": "Duration",
            "help": "Duration of the generated audio in seconds.",
            "type": "number",
            "step": 1,
            "default": 8
          },
          {
            "name": "continuation",
            "label": "Continuation",
            "help": "If `True`, generated music will continue from `input_audio`. Otherwise, generated music will mimic `input_audio`'s melody.",
            "type": "toggle",
            "default": false
          },
          {
            "name": "continuation_start",
            "label": "Continuation Start",
            "help": "Start time of the audio file to use for continuation.",
            "type": "number",
            "min": 0,
            "step": 1,
            "default": 0
          },
          {
            "name": "continuation_end",
            "label": "Continuation End",
            "help": "End time of the audio file to use for continuation. If -1 or None, will default to the end of the audio clip.",
            "type": "number",
            "min": 0,
            "step": 1
          },
          {
            "name": "multi_band_diffusion",
            "label": "Multi Band Diffusion",
            "help": "If `True`, the EnCodec tokens will be decoded with MultiBand Diffusion. Only works with non-stereo models.",
            "type": "toggle",
            "default": false
          },
          {
            "name": "normalization_strategy",
            "label": "normalization_strategy",
            "help": "Strategy for normalizing audio.",
            "type": "select",
            "options": [
              {
                "value": "loudness",
                "label": "loudness"
              },
              {
                "value": "clip",
                "label": "clip"
              },
              {
                "value": "peak",
                "label": "peak"
              },
              {
                "value": "rms",
                "label": "rms"
              }
            ],
            "default": "loudness"
          },
          {
            "name": "top_k",
            "label": "Top K",
            "help": "Reduces sampling to the k most likely tokens.",
            "type": "number",
            "step": 1,
            "default": 250
          },
          {
            "name": "top_p",
            "label": "Top P",
            "help": "Reduces sampling to tokens with cumulative probability of p. When set to  `0` (default), top_k sampling is used.",
            "type": "number",
            "step": 0.1,
            "default": 0
          },
          {
            "name": "temperature",
            "label": "Temperature",
            "help": "Controls the 'conservativeness' of the sampling process. Higher temperature means more diversity.",
            "type": "number",
            "step": 0.1,
            "default": 1
          },
          {
            "name": "classifier_free_guidance",
            "label": "Classifier Free Guidance",
            "help": "Increases the influence of inputs on the output. Higher values produce lower-varience outputs that adhere more closely to inputs.",
            "type": "number",
            "step": 1,
            "default": 3
          },
          {
            "name": "output_format",
            "label": "output_format",
            "help": "Output format for generated audio.",
            "type": "select",
            "options": [
              {
                "value": "wav",
                "label": "wav"
              },
              {
                "value": "mp3",
                "label": "mp3"
              }
            ],
            "default": "wav"
          },
          {
            "name": "seed",
            "label": "Seed",
            "help": "Seed for random number generator. If None or -1, a random seed will be used.",
            "type": "number",
            "step": 1
          }
        ]
      },
      {
        "id": "riffusion/riffusion",
        "label": "riffusion",
        "fields": [
          {
            "name": "prompt_a",
            "label": "Prompt A",
            "help": "The prompt for your audio",
            "type": "text",
            "default": "funky synth solo"
          },
          {
            "name": "denoising",
            "label": "Denoising",
            "help": "How much to transform input spectrogram",
            "type": "number",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 0.75
          },
          {
            "name": "prompt_b",
            "label": "Prompt B",
            "help": "The second prompt to interpolate with the first, leave blank if no interpolation",
            "type": "text"
          },
          {
            "name": "alpha",
            "label": "Alpha",
            "help": "Interpolation alpha if using two prompts. A value of 0 uses prompt_a fully, a value of 1 uses prompt_b fully",
            "type": "number",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 0.5
          },
          {
            "name": "num_inference_steps",
            "label": "Num Inference Steps",
            "help": "Number of steps to run the diffusion model",
            "type": "number",
            "min": 1,
            "step": 1,
            "default": 50
          },
          {
            "name": "seed_image_id",
            "label": "seed_image_id",
            "help": "Seed spectrogram to use",
            "type": "select",
            "options": [
              {
                "value": "agile",
                "label": "agile"
              },
              {
                "value": "marim",
                "label": "marim"
              },
              {
                "value": "mask_beat_lines_80",
                "label": "mask_beat_lines_80"
              },
              {
                "value": "mask_gradient_dark",
                "label": "mask_gradient_dark"
              },
              {
                "value": "mask_gradient_top_70",
                "label": "mask_gradient_top_70"
              },
              {
                "value": "mask_graident_top_fifth_75",
                "label": "mask_graident_top_fifth_75"
              },
              {
                "value": "mask_top_third_75",
                "label": "mask_top_third_75"
              },
              {
                "value": "mask_top_third_95",
                "label": "mask_top_third_95"
              },
              {
                "value": "motorway",
                "label": "motorway"
              },
              {
                "value": "og_beat",
                "label": "og_beat"
              },
              {
                "value": "vibes",
                "label": "vibes"
              }
            ],
            "default": "vibes"
          }
        ]
      }
    ]
  },
  "website": "https://replicate.com",
  "description": {
    "en": "Run and fine-tune open-source image, video, and audio models through one API — from FLUX and Stable Diffusion to video upscalers and music generators."
  }
};
