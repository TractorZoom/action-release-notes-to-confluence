export type RepoRef = {
  owner: string;
  repo: string;
};

export type Category = {
  title: string;
  prs: { line: string; number: number }[];
};

export type ReleaseInfo = {
  name: string;
  tagName: string;
  body: string;
};


