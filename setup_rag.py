import os
import time
from openai import OpenAI
from dotenv import load_dotenv

def setup_vector_store():
    """
    Sets up the OpenAI vector store for RAG with MULTIPLE files.
    1. Loads the OpenAI API key from .env.
    2. Creates a single vector store for all courses.
    3. Uploads all PDF/DOCX files from the 'uploads/' folder.
    4. Attaches all files to the vector store.
    5. Polls until all files are processed.
    6. Prints the vector store ID to be added to the .env file.
    """
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not found in .env file.")
        return

    client = OpenAI(api_key=api_key)

    # Auto-discover all supported files in the uploads/ folder
    uploads_dir = "uploads"
    supported_extensions = (".pdf", ".docx", ".doc", ".txt", ".md")

    if not os.path.isdir(uploads_dir):
        print(f"Error: The '{uploads_dir}' folder does not exist.")
        print("Please create it and place your course documents inside.")
        return

    files_to_upload = [
        os.path.join(uploads_dir, f)
        for f in os.listdir(uploads_dir)
        if f.lower().endswith(supported_extensions)
    ]

    if not files_to_upload:
        print(f"No supported files found in '{uploads_dir}/'.")
        print(f"Supported formats: {', '.join(supported_extensions)}")
        return

    print(f"\nFound {len(files_to_upload)} file(s) to upload:")
    for f in files_to_upload:
        print(f"  - {f}")
    print()

    try:
        # 1. Create a single vector store for all courses
        vector_store = client.vector_stores.create(name="Euroformac Knowledge Base - All Courses")
        vs_id = vector_store.id
        print(f"Vector Store created. ID: {vs_id}\n")

        uploaded_file_ids = []

        # 2. Upload each file
        for file_path in files_to_upload:
            print(f"Uploading: {file_path} ...")
            with open(file_path, "rb") as file_stream:
                file_response = client.files.create(file=file_stream, purpose="assistants")
                file_id = file_response.id
                print(f"  -> Uploaded. File ID: {file_id}")
                uploaded_file_ids.append(file_id)

        print()

        # 3. Attach all files to the vector store in a single batch
        print("Attaching all files to the Vector Store in batch...")
        batch = client.vector_stores.file_batches.create(
            vector_store_id=vs_id,
            file_ids=uploaded_file_ids
        )
        print(f"Batch created. Batch ID: {batch.id}")

        # 4. Poll for batch completion
        print("Waiting for all files to be processed...")
        while True:
            batch = client.vector_stores.file_batches.retrieve(
                vector_store_id=vs_id,
                batch_id=batch.id
            )
            counts = batch.file_counts
            print(f"  Status: {batch.status} | "
                  f"Completed: {counts.completed} | "
                  f"In progress: {counts.in_progress} | "
                  f"Failed: {counts.failed}")

            if batch.status in ("completed", "failed", "cancelled"):
                break

            time.sleep(10)

        if counts.failed > 0:
            print(f"\nWarning: {counts.failed} file(s) failed to process.")
            print("Check OpenAI dashboard for details.")

        print("\n--- SETUP COMPLETE ---")
        print(f"Successfully processed {counts.completed} of {len(files_to_upload)} files.")
        print("\nPlease add the following line to your .env file (replace old VECTOR_STORE_ID):")
        print(f"\nVECTOR_STORE_ID={vs_id}\n")
        print("Also set this same value in Netlify → Site settings → Environment variables.")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    setup_vector_store()