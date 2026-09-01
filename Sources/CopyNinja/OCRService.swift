import CoreGraphics
import Foundation
import ImageIO
import Vision

/// On-device text recognition backed by Apple's Vision framework
/// (VNRecognizeTextRequest) with Korean + English support.
enum OCRService {
    /// Extracts text from PNG image data. Returns `nil` when decoding or
    /// recognition fails, or when no text is found.
    static func recognizeText(pngData: Data) async -> String? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                guard let source = CGImageSourceCreateWithData(pngData as CFData, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                    continuation.resume(returning: nil)
                    return
                }

                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.recognitionLanguages = ["ko-KR", "en-US"]
                request.usesLanguageCorrection = true

                let handler = VNImageRequestHandler(cgImage: image, options: [:])
                do {
                    try handler.perform([request])
                    let lines = request.results?
                        .compactMap { $0.topCandidates(1).first?.string } ?? []
                    let text = lines.joined(separator: "\n")
                    continuation.resume(returning: text.isEmpty ? nil : text)
                } catch {
                    NSLog("CopyNinja: OCR failed — \(error.localizedDescription)")
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}
