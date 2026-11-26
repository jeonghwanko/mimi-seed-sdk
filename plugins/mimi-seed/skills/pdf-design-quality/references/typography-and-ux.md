# Typography and document UX

## Korean type

- Choose a body face with clear interior spaces and recognizable glyphs at the actual reading size. Noto Sans KR and Pretendard are useful starting points. A Korean serif such as Noto Serif KR may suit editorial titles. When a user criticizes the typography, compare representative lines in realistic alternatives before settling on a direction.
- Start a short A4 document around 10.5–12 pt with a line-height ratio near 1.5–1.65, then adjust after rendering at delivery size. These are starting points. Glyph density, reading distance, and viewing scale affect the choice.
- Keep native character proportions. Check dense syllables, mixed Hangul and Latin text, and dates, numbers, and units. Keep date/time and quantity/unit groups together where possible. Avoid isolated syllables, detached punctuation, and stranded currency units. Use a consistent left edge for multiline prose and data unless the design calls for different alignment.
- Pin variable faces to the intended weights when the renderer needs static fonts. Give compiled instances distinct PostScript names if the backend deduplicates faces by name. Inspect the embedded fonts, copy representative Korean text and values, and visually check all weights. Font rendering and text extraction are separate checks.

## Document layout and QA

- Name sections for the questions readers bring. For a first ad proposal, surface what will run, when it will run, its price and audience, and how to respond. Keep reporting metrics specific. Label a mock ad or artwork if readers could mistake it for an actual result.
- Scan the rendered page by looking only at its title, section headings, and next action. Each should carry distinct information. Use borders, highlights, panels, and images in proportion to their role.
- A render near 390 px wide helps assess phone-width fit. Check the hierarchy at fit and inspect the typography at a readable zoom. Verify page count when constrained. Cross-check dates, prices, and figures with the surrounding materials.
- Retain editable source when the user needs to adapt a proposal or template. The final shareable PDF should still work on its own.

## Research

- He, Baek, and Legge measured how Korean reading speed varied with print size and visual eccentricity. Check sizing at the intended viewing scale. The experiment does not establish a universal point size. [Korean Reading Speed](https://pmc.ncbi.nlm.nih.gov/articles/PMC6139278/)
- The study by Jae-Hong Park on adapting Noto Sans for small Korean text discusses proportions, stroke weight, spacing, and interior space. Review these features together in a rendered sample. [Mobile Text Readability Improvement Study of Korean Font](https://www.koreascience.or.kr/article/JAKO202325051029868.pdf)
- Klusewitz and Lorch varied heading types in controlled information-search tasks. Descriptive headings make the structure available to a reader looking for a specific answer. [Effects of headings and familiarity with a text on strategies for searching a text](https://link.springer.com/article/10.3758/BF03201256)
- Nielsen Norman Group's eye-tracking observations describe scanning guided by visible and informative headings. The observations concern web reading and motivate a similar check for a screen-delivered PDF. [The Layer-Cake Pattern of Scanning Content on the Web](https://www.nngroup.com/articles/layer-cake-pattern-scanning/)
