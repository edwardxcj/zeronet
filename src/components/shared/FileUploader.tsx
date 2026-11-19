import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { convertFileToUrl } from "@/lib/utils";
import { Button } from "../ui/button";

type FileUploaderProps = {
  fieldChange: (files: File[]) => void;
  mediaUrl?: string;
  files: File[];
  disabled?: boolean;
};

const FileUploader = ({ fieldChange, mediaUrl, files, disabled = false }: FileUploaderProps) => {
  const [previewUrl, setPreviewUrl] = useState<string>();
  const fileUrl = previewUrl ?? mediaUrl;
  const selectedFile = files[0];
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    const url = selectedFile ? convertFileToUrl(selectedFile) : undefined;
    setPreviewUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [selectedFile]);

  const onDropAccepted = useCallback(
    (acceptedFiles: File[]) => {
      // An already-open file picker may finish after publication starts.
      if (!disabledRef.current) fieldChange(acceptedFiles);
    },
    [fieldChange]
  );

  const { getRootProps, getInputProps, fileRejections } = useDropzone({
    onDropAccepted,
    useFsAccessApi: false,
    disabled,
    multiple: false,
    minSize: 1,
    accept: {
      "image/*": [".png", ".jpeg", ".jpg"],
    },
  });

  return (
    <div
      {...getRootProps()}
      aria-disabled={disabled}
      className={`flex flex-center flex-col bg-dark-3 rounded-xl ${disabled ? "cursor-wait opacity-60" : "cursor-pointer"}`}
    >
      <input {...getInputProps()} className="cursor-pointer" />

      {fileUrl ? (
        <>
          <div className="flex flex-1 justify-center w-full p-5 lg:p-10">
            <img src={fileUrl} alt="image" className="file_uploader-img" />
          </div>
          <p className="file_uploader-label">Click or drag photo to replace</p>
        </>
      ) : (
        <div className="file_uploader-box ">
          <img
            src="/assets/icons/file-upload.svg"
            width={96}
            height={77}
            alt="file upload"
          />

          <h3 className="base-medium text-light-2 mb-2 mt-6">
            Drag photo here
          </h3>
          <p className="text-light-4 small-regular mb-6">For example, PNG or JPG</p>

          <Button type="button" disabled={disabled} className="shad-button_dark_4">
            Select from computer
          </Button>
        </div>
      )}
      {selectedFile && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="mb-4 text-light-2"
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (!disabledRef.current) fieldChange([]);
          }}
        >
          {mediaUrl ? "Use current photo" : "Remove photo"}
        </Button>
      )}
      {fileRejections.length > 0 && (
        <p role="alert" className="small-regular px-4 pb-4 text-red-400">
          Choose one image file that is not empty.
        </p>
      )}
    </div>
  );
};

export default FileUploader;
