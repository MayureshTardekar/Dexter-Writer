export type DocMode = 'markdown' | 'latex' | 'typst';

export interface StarterTemplate {
  id: string;
  label: string;
  mode: DocMode;
  description: string;
  content: string;
}

export const TEMPLATES: StarterTemplate[] = [
  {
    id: 'resume-md',
    label: 'ATS Resume (.md)',
    mode: 'markdown',
    description: 'Software engineer resume, ATS-friendly',
    content: `# Alex Carter
Full-Stack Software Engineer | alex.carter@email.com | github.com/alexcarter | linkedin.com/in/alexcarter | alexcarter.dev

## Technical Skills
- **Languages:** TypeScript, Python, Go, SQL
- **Frameworks:** React, Node.js, Next.js, FastAPI
- **Cloud & DevOps:** AWS, Docker, Kubernetes, GitHub Actions
- **Databases:** PostgreSQL, Redis, MongoDB

## Professional Experience

### Senior Software Engineer — Acme Cloud (2022 — Present)
- Shipped multi-tenant billing API serving **2M+ requests/day**, cutting p99 latency by **38%** ($E=mc^2$ not required, metrics required).
- Led migration from REST to GraphQL, reducing over-fetching by **45%** and mobile payload size by 60%.
- Mentored 4 engineers; drove RFC process and on-call runbooks.

### Software Engineer — Datawise (2020 — 2022)
- Built real-time ingestion pipeline (Kafka + ClickHouse) processing **500M events/month**.
- Improved test coverage from 41% to 89%; cut CI time from 22min to 9min.

## Featured Projects
- **dexter-search** — Open-source semantic code search (TS, Qdrant). ★ 1.2k GitHub stars. [Live demo](https://example.com)
- **invoice-gen** — Typst-powered invoice generator with PDF export. 8k downloads/mo.

## Education & Certifications
- B.S. Computer Science — State University (2016 — 2020)
- AWS Solutions Architect Associate (2023)

> Tip: select any bullet and press **Ask AI** to rewrite it with stronger action verbs.
`,
  },
  {
    id: 'resume-tex',
    label: 'ATS Resume (.tex)',
    mode: 'latex',
    description: 'Same resume in LaTeX article class',
    content: `% Dexter Write — ATS Resume (LaTeX)
\\documentclass[11pt,a4paper]{article}
\\usepackage[margin=0.7in]{geometry}
\\usepackage{hyperref}
\\usepackage{enumitem}
\\setlist[itemize]{noitemsep, topsep=2pt}
\\pagestyle{empty}
\\begin{document}
\\begin{center}
{\\LARGE \\textbf{Alex Carter}} \\\\[2pt]
Full-Stack Software Engineer \\\\[2pt]
\\small alex.carter@email.com \\quad | \\quad github.com/alexcarter \\quad | \\quad linkedin.com/in/alexcarter
\\end{center}

\\section*{Technical Skills}
\\textbf{Languages:} TypeScript, Python, Go, SQL \\\\
\\textbf{Frameworks:} React, Node.js, Next.js, FastAPI \\\\
\\textbf{Cloud:} AWS, Docker, Kubernetes, GitHub Actions

\\section*{Professional Experience}
\\textbf{Senior Software Engineer --- Acme Cloud (2022 -- Present)}
\\begin{itemize}
\\item Shipped billing API serving 2M+ requests/day; cut p99 latency by 38\\%.
\\item Led REST to GraphQL migration; reduced payload size by 60\\%.
\\item Mentored 4 engineers; owned RFC and on-call process.
\\end{itemize}

\\textbf{Software Engineer --- Datawise (2020 -- 2022)}
\\begin{itemize}
\\item Built Kafka + ClickHouse pipeline for 500M events/month.
\\item Raised coverage 41\\% to 89\\%; cut CI 22min to 9min.
\\end{itemize}

\\section*{Education}
B.S. Computer Science --- State University (2016 -- 2020) \\\\
AWS Solutions Architect Associate (2023)
\\end{document}
`,
  },
  {
    id: 'resume-jake-tex',
    label: "Jake's Resume (.tex)",
    mode: 'latex',
    description: "Standard CS / Software Engineer resume based on Jake's Resume",
    content: `%-------------------------
% Resume in Latex - Jake's Template
% License : MIT
%------------------------

\\documentclass[letterpaper,11pt]{article}

\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

% Adjust margins
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}

\\urlstyle{same}

\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

% Custom commands for Jake's Resume
\\newcommand{\\resumeItem}[1]{
  \\item\\small{
    {#1 \\vspace{-2pt}}
  }
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & #2 \\\\
      \\textit{\\small#3} & \\textit{\\small #4} \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\small#1 & #2 \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}

\\begin{document}

\\begin{center}
    \\textbf{\\Huge \\scshape Your Name} \\\\ \\vspace{3pt}
    \\small City, State $|$ +1 (555) 123-4567 $|$ \\href{mailto:your.email@example.com}{\\underline{your.email@example.com}} \\\\
    \\href{https://linkedin.com/in/yourusername}{\\underline{linkedin.com/in/yourusername}} $|$
    \\href{https://github.com/yourusername}{\\underline{github.com/yourusername}}
\\end{center}

\\section{Education}
  \\resumeItemListStart
    \\resumeSubheading
      {University Name}{City, State}
      {Degree / Field of Study}{2022 -- 2026}
    \\resumeSubheading
      {College Name}{City, State}
      {Relevant Degree / Honors}{2018 -- 2022}
  \\resumeItemListEnd

\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
     \\textbf{Languages}{: Python, TypeScript, JavaScript, SQL, C++, Java} \\\\
     \\textbf{Frameworks \\& Libraries}{: React, Node.js, Express, FastAPI, Tailwind CSS} \\\\
     \\textbf{Tools \\& Databases}{: PostgreSQL, Redis, Docker, Git, Linux, AWS} \\\\
     \\textbf{Core Competencies}{: REST APIs, Distributed Systems, Data Structures, System Design}
    }}
 \\end{itemize}

\\section{Projects}
    \\resumeItemListStart
      \\resumeProjectHeading
          {\\textbf{Project Name} $|$ \\emph{React, TypeScript, Node.js, PostgreSQL}}{2026}
          \\resumeItemListStart
            \\resumeItem{Built a scalable web platform handling user authentication, data management, and real-time updates.}
            \\resumeItem{Implemented efficient database querying and indexing, improving API response times.}
            \\resumeItem{Designed responsive modern user interface with reusable component architecture.}
          \\resumeItemListEnd
      \\resumeProjectHeading
          {\\textbf{Secondary Project} $|$ \\emph{Python, FastAPI, Redis, Docker}}{2025}
          \\resumeItemListStart
            \\resumeItem{Developed automated data processing pipeline with error handling and logging.}
            \\resumeItem{Integrated background task queue for reliable asynchronous job execution.}
          \\resumeItemListEnd
    \\resumeItemListEnd

\\end{document}
`,
  },
  {
    id: 'paper-tex',
    label: 'Research Paper (.tex)',
    mode: 'latex',
    description: 'Article class with math + bibliography',
    content: `% Dexter Write — Academic Paper
\\documentclass[11pt,a4paper]{article}
\\usepackage{amsmath, amssymb}
\\usepackage{hyperref}
\\title{Efficient Retrieval for Technical Documentation}
\\author{Alex Carter \\and Dana Lee}
\\date{\\today}
\\begin{document}
\\maketitle
\\begin{abstract}
We study chunking strategies for retrieval-augmented generation over API docs.
Our method improves recall@5 by 12 points on a 40k-page corpus.
\\end{abstract}

\\section{Introduction}
Technical documentation is large, versioned, and structured.
Large language models hallucinate endpoints without grounding.

\\section{Methodology}
Given query $q$ and chunks $C$, score $s(q, c) = \\cos(E(q), E(c))$.
We optimize display math:
$$\\mathcal{L} = -\\sum_{(q,c^+)} \\log \\frac{\\exp(s(q,c^+))}{\\sum_c \\exp(s(q,c))}$$

\\section{Results}
\\begin{itemize}
\\item Baseline recall@5: 0.61
\\item Ours recall@5: 0.73
\\item Latency p50: 180ms
\\end{itemize}

\\section{Conclusion}
Structure-aware chunking helps. Future work: citation grounding.

\\begin{thebibliography}{9}
\\bibitem{vaswani17} Vaswani et al. Attention is all you need. 2017.
\\end{thebibliography}
\\end{document}
`,
  },
  {
    id: 'resume-typ',
    label: 'ATS Resume (.typ)',
    mode: 'typst',
    description: 'Software engineer resume with instant PDF',
    content: `// Dexter Write — ATS Resume (Typst)
#set page(margin: (x: 1.8cm, y: 1.6cm))
#set text(size: 10.5pt)
#set par(justify: true, leading: 0.55em)

#align(center)[
  #text(size: 20pt, weight: "bold")[Alex Carter] \\
  Full-Stack Software Engineer \\
  #text(size: 9pt)[alex.carter@email.com #h(1em) github.com/alexcarter #h(1em) linkedin.com/in/alexcarter]
]
#line(length: 100%)

= Technical Skills
- *Languages:* TypeScript, Python, Go, SQL
- *Frameworks:* React, Node.js, Next.js, FastAPI
- *Cloud:* AWS, Docker, Kubernetes, GitHub Actions

= Professional Experience
== Senior Software Engineer — Acme Cloud (2022 — Present)
- Shipped billing API serving 2M+ requests/day; cut p99 latency by 38%.
- Led REST to GraphQL migration; reduced payload size by 60%.
- Mentored 4 engineers; owned RFC and on-call process.

== Software Engineer — Datawise (2020 — 2022)
- Built Kafka + ClickHouse pipeline for 500M events/month.
- Raised coverage 41% to 89%; cut CI from 22min to 9min.

= Education
B.S. Computer Science — State University (2016 — 2020) \\
AWS Solutions Architect Associate (2023)
`,
  },
  {
    id: 'paper-typ',
    label: 'Research Paper (.typ)',
    mode: 'typst',
    description: 'Article with math, figures and bibliography',
    content: `// Dexter Write — Academic Paper (Typst)
#set page(margin: 2cm)
#set text(font: "New Computer Modern", size: 11pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.")

#align(center)[
  #text(size: 18pt, weight: "bold")[Efficient Retrieval for Technical Documentation] \\
  #v(0.4em)
  Alex Carter, Dana Lee \\
  #text(size: 9pt)[#datetime.today().display()]
]

= Introduction
Technical documentation is large, versioned, and structured.
Large language models hallucinate endpoints without grounding.

= Methodology
Given query $q$ and chunks $C$, score $s(q, c) = cos(E(q), E(c))$.
We optimize display math:
$ cal(L) = -sum_((q,c^+)) log (exp(s(q,c^+)) / sum_c exp(s(q,c))) $

= Results
- Baseline recall\\@5: 0.61
- Ours recall\\@5: 0.73
- Latency p50: 180ms

= Conclusion
Structure-aware chunking helps. Future work: citation grounding.

#bibliography("refs.bib", style: "ieee")
`,
  },
  {
    id: 'api-md',
    label: 'API Docs (.md)',
    mode: 'markdown',
    description: 'Technical product & API specification',
    content: `# 🪐 Project Nebula — Distributed Semantic Search Engine

> **Version 1.4.0** · Status: \`Production Ready\` · Auth: \`Bearer Token\` · Base URL: \`https://api.nebula.dev/v1\`

## 🏗️ System Architecture

Dexter Write renders full **Mermaid.js** diagrams live in Markdown:

\`\`\`mermaid
graph LR
  Client[Client Application] --> Gateway[API Gateway / Auth]
  Gateway --> Cache[(Redis L1 Cache)]
  Gateway --> Engine[Semantic Retrieval Engine]
  Engine --> Embeddings[Transformer Embeddings]
  Engine --> VectorDB[(Qdrant Vector DB)]
  style Gateway fill:#6366f1,stroke:#8b5cf6,stroke-width:2px,color:#fff
  style Engine fill:#34d3a6,stroke:#059669,stroke-width:2px,color:#000
  style VectorDB fill:#ec4899,stroke:#db2777,stroke-width:2px,color:#fff
\`\`\`

---

## 📐 Mathematical Formulation

Relevance ranking scores are computed via cosine similarity and temperature-scaled **InfoNCE** loss [@vaswani2017attention]:

$$\\mathcal{L}_{\\text{InfoNCE}} = -\\sum_{i=1}^B \\log \\frac{\\exp(\\text{sim}(q_i, d_i^+) / \\tau)}{\\sum_{j=1}^B \\exp(\\text{sim}(q_i, d_j) / \\tau)}$$

Mean Reciprocal Rank (MRR) across evaluation query set $Q$:

$$\\text{MRR} = \\frac{1}{|Q|} \\sum_{i=1}^{|Q|} \\frac{1}{\\text{rank}_i}$$

---

## ⚡ Performance Benchmarks

| Indexing Strategy | Recall@5 | Latency (p99) | Throughput (QPS) | Memory (GB) |
| :---------------- | :------: | :-----------: | :--------------: | :---------: |
| Dense Cosine      | 84.2%    | 18ms          | 4,200            | 3.2 GB      |
| HNSW + Quantized  | 92.6%    | 12ms          | 8,900            | 1.8 GB      |
| **Nebula Hybrid** | **96.8%**| **8ms**       | **12,400**       | **1.4 GB**  |

---

## 💻 Quickstart (Python SDK)

\`\`\`python
from nebula import Client

# Initialize client with local or cloud endpoint
client = Client(api_key="nebula_live_token")

# Query semantic vector index
results = client.search(
    query="real-time collaborative Overleaf alternative",
    top_k=5,
    threshold=0.85
)

for doc in results:
    print(f"[{doc.score:.2f}] {doc.title}")
\`\`\`

- [x] WebAssembly Typst vector typesetting
- [x] Autonomous Document Review Agent
- [x] In-browser arXiv and Crossref citation discovery
- [ ] Multi-region active replication
`,
  },
];

export function getTemplate(id: string): StarterTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
