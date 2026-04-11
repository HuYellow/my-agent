process.stdin.setEncoding("utf8");

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const payload = input.trim() ? JSON.parse(input) : {};
  const task = typeof payload.task === "string" ? payload.task : "No task provided.";
  process.stdout.write(
    JSON.stringify(
      {
        summary: "changelog-helper example plugin ran successfully.",
        task,
      },
      null,
      2,
    ),
  );
});
