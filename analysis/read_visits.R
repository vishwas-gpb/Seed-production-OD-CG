# Read the synced Field Visit Log from the Google Sheet and summarise.
# Set your Sheet ID (from its URL: /spreadsheets/d/SHEET_ID/edit) and make the
# sheet viewable to "Anyone with the link".

sheet_id <- "PASTE_YOUR_SHEET_ID_HERE"
url <- paste0("https://docs.google.com/spreadsheets/d/", sheet_id, "/export?format=csv")
df  <- read.csv(url, stringsAsFactors = FALSE, check.names = FALSE)

cat("Total visits:", nrow(df), "\n\n")

# visits by staff
cat("Visits by field staff:\n"); print(sort(table(df$staff_name), decreasing = TRUE))

# visit frequency: visits per staff per week
if (nrow(df) > 0) {
  df$week <- format(as.Date(df$visit_date), "%Y-W%U")
  cat("\nVisits per staff per week:\n")
  print(as.data.frame(table(staff = df$staff_name, week = df$week)))
}

# crop stage / condition breakdown
cat("\nBy crop stage:\n");  print(table(df$crop_stage))
cat("\nBy condition:\n");   print(table(df$condition))
