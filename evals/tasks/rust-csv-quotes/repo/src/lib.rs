#[derive(Debug, PartialEq, Eq)]
pub enum CsvError {
    UnterminatedQuote,
}

/// Splits one CSV line into its fields.
pub fn split_csv_line(line: &str) -> Result<Vec<String>, CsvError> {
    Ok(line.split(',').map(String::from).collect())
}
