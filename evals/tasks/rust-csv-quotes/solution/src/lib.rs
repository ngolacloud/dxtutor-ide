#[derive(Debug, PartialEq, Eq)]
pub enum CsvError {
    UnterminatedQuote,
}

/// Splits one CSV line into its fields (RFC 4180, one line).
pub fn split_csv_line(line: &str) -> Result<Vec<String>, CsvError> {
    let mut out = vec![];
    let mut field = String::new();
    let mut chars = line.chars().peekable();
    let mut quoted = false;
    let mut at_start = true;
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' && at_start {
            quoted = true;
            at_start = false;
        } else if c == ',' {
            out.push(std::mem::take(&mut field));
            at_start = true;
        } else {
            field.push(c);
            at_start = false;
        }
    }
    if quoted {
        return Err(CsvError::UnterminatedQuote);
    }
    out.push(field);
    Ok(out)
}
